/**
 * Google Calendar free/busy provider.
 *
 * Implements FreeBusyProvider for the dispatcher. The full path for one
 * member's free/busy lookup:
 *
 *   1. Check free_busy_cache. Hit + fresh -> return immediately.
 *   2. Open a transaction, lock the token row with FOR UPDATE SKIP LOCKED.
 *      (Skip-locked means a concurrent refresh on the same user simply
 *      returns null here; that caller skips this member for the current
 *      run rather than waiting.)
 *   3. Decrypt the access token. If it's within 60s of expiring, refresh
 *      eagerly using the stored refresh_token, save the new encrypted
 *      tokens back. The 60s margin avoids the "expired during the call"
 *      race that would force a retry.
 *   4. POST the freeBusy query with the access token. AbortController is
 *      threaded through so a Fly SIGTERM mid-request closes the socket.
 *   5. Persist the result to free_busy_cache.
 *   6. Return the busy intervals as Date pairs.
 *
 * Two custom error classes signal recoverable failures the caller should
 * handle distinctly:
 *   - GoogleNotConnectedError: user has no calendar_tokens row. Caller
 *     should skip this member.
 *   - GoogleReauthRequiredError: refresh_token is bad (invalid_grant).
 *     Caller should mark the member as disconnected and DM them to
 *     reconnect.
 */

import type { Pool } from "pg";
import type { FreeBusyProvider } from "../llm/dispatcher.js";
import type { TokenVault } from "../auth/token-vault.js";
import type { GoogleOAuthConfig } from "../auth/google-oauth.js";
import { refreshAccessToken } from "../auth/google-oauth.js";
import {
  getCalendarTokenForUser,
  readFreeBusyCache,
  saveCalendarToken,
  writeFreeBusyCache,
} from "../db/queries.js";

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const REFRESH_MARGIN_MS = 60_000; // refresh if token expires within 60s

export class GoogleNotConnectedError extends Error {
  constructor(userId: string) {
    super(`Google not connected for user ${userId}`);
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleReauthRequiredError extends Error {
  public override readonly cause?: unknown;
  constructor(userId: string, cause?: unknown) {
    super(`Google refresh failed for user ${userId}; re-auth required`);
    this.name = "GoogleReauthRequiredError";
    this.cause = cause;
  }
}

export interface GoogleCalendarProviderOptions {
  readonly pool: Pool;
  readonly vault: TokenVault;
  readonly oauthConfig: GoogleOAuthConfig;
  /** Test seam. Defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Test seam. Defaults to () => new Date(). */
  readonly now?: () => Date;
}

export class GoogleCalendarProvider implements FreeBusyProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: GoogleCalendarProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async getFreeBusy(input: {
    readonly userId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly signal?: AbortSignal;
  }): Promise<ReadonlyArray<{ readonly start: Date; readonly end: Date }>> {
    const { userId, windowStart, windowEnd, signal } = input;

    // Step 1: cache hit?
    const cached = await readFreeBusyCache(this.options.pool, userId, windowStart, windowEnd);
    if (cached) {
      return cached.busyPeriods.map((p) => ({
        start: new Date(p.start),
        end: new Date(p.end),
      }));
    }

    // Step 2-3: locked refresh (if needed), all inside a single transaction.
    const accessToken = await this.getValidAccessToken(userId);

    // Step 4: query Google freeBusy.
    const busy = await this.queryFreeBusy(accessToken, windowStart, windowEnd, signal);

    // Step 5: persist to cache (best-effort; cache failure doesn't fail the call).
    try {
      await writeFreeBusyCache(this.options.pool, {
        userId,
        windowStart,
        windowEnd,
        busyPeriods: busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
      });
    } catch (err) {
      // Swallow: returning real busy is more important than caching it.
      // The next run will retry the write.
    }

    return busy;
  }

  /**
   * Returns a fresh access token, refreshing if needed. Wraps the token
   * row in FOR UPDATE SKIP LOCKED so concurrent refreshes don't clobber.
   */
  private async getValidAccessToken(userId: string): Promise<string> {
    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");

      const row = await getCalendarTokenForUser(client, userId, "google");
      if (!row) {
        // Either the user has no Google token at all, or another worker
        // currently holds the lock (SKIP LOCKED returns null in both
        // cases). Caller skips this member.
        await client.query("COMMIT");
        throw new GoogleNotConnectedError(userId);
      }

      const needsRefresh =
        row.expires_at !== null &&
        row.expires_at.getTime() - this.now().getTime() < REFRESH_MARGIN_MS;

      if (!needsRefresh) {
        const token = this.options.vault.decrypt(row.encrypted_access_token);
        await client.query("COMMIT");
        return token;
      }

      // Refresh path.
      if (!row.encrypted_refresh_token) {
        // Token expired but no refresh_token on file. Shouldn't happen
        // with our authorize flow (we force prompt=consent + offline)
        // but defend against it: caller treats as re-auth required.
        await client.query("COMMIT");
        throw new GoogleReauthRequiredError(userId);
      }

      const refreshToken = this.options.vault.decrypt(row.encrypted_refresh_token);
      let refreshed;
      try {
        refreshed = await refreshAccessToken(this.options.oauthConfig, refreshToken, this.fetchImpl);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new GoogleReauthRequiredError(userId, err);
      }

      // Save the new tokens inside the same transaction.
      await saveCalendarToken(client, {
        userId,
        provider: "google",
        scope: row.scope,
        encryptedAccessToken: this.options.vault.encrypt(refreshed.accessToken),
        encryptedRefreshToken: refreshed.refreshToken
          ? this.options.vault.encrypt(refreshed.refreshToken)
          : row.encrypted_refresh_token, // keep the one we had
        expiresAt: refreshed.expiresAt,
      });

      await client.query("COMMIT");
      return refreshed.accessToken;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // If ROLLBACK fails (e.g. client already errored), nothing to do.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async queryFreeBusy(
    accessToken: string,
    windowStart: Date,
    windowEnd: Date,
    signal: AbortSignal | undefined,
  ): Promise<ReadonlyArray<{ readonly start: Date; readonly end: Date }>> {
    const body = JSON.stringify({
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      items: [{ id: "primary" }],
    });

    const response = await this.fetchImpl(FREEBUSY_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body,
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Google freeBusy failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
      );
    }

    const json = (await response.json()) as {
      calendars?: Record<string, { busy?: ReadonlyArray<{ start?: string; end?: string }> }>;
    };

    const primary = json.calendars?.["primary"];
    const rawBusy = primary?.busy ?? [];

    return rawBusy
      .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
}
