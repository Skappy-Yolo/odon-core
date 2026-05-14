import { describe, expect, it } from "vitest";
import {
  GoogleCalendarProvider,
  GoogleNotConnectedError,
  GoogleReauthRequiredError,
} from "../../src/providers/google-calendar.js";
import type { TokenVault } from "../../src/auth/token-vault.js";
import type { GoogleOAuthConfig } from "../../src/auth/google-oauth.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const oauthConfig: GoogleOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://odon.gg/oauth/google/callback",
};

/**
 * Trivial pass-through "vault" for tests: encrypt returns the string as a
 * Buffer, decrypt converts Buffer back to string. The provider doesn't
 * care about the encryption scheme; it only cares that round-trip works.
 */
const fakeVault: TokenVault = {
  encrypt: (s) => Buffer.from(s, "utf8"),
  decrypt: (b) => b.toString("utf8"),
};

/**
 * Fake pg.Pool that returns canned query results. The provider issues a
 * sequence of queries inside a transaction: BEGIN, SELECT calendar_tokens
 * ... FOR UPDATE, optionally INSERT INTO calendar_tokens, COMMIT. We
 * replay scripted responses.
 */
interface ScriptedResponse {
  rows?: ReadonlyArray<Record<string, unknown>>;
}

function makePool(script: ScriptedResponse[]) {
  let i = 0;
  const release = () => {};
  const client = {
    query: async (_text: string, _params?: ReadonlyArray<unknown>) => {
      const next = script[i++];
      return next ?? { rows: [] };
    },
    release,
  };
  return {
    connect: async () => client,
    query: async (text: string, params?: ReadonlyArray<unknown>) => {
      // Pool-level queries are used for free_busy_cache reads/writes,
      // outside the transaction. Treat them the same way.
      return client.query(text, params);
    },
  } as unknown as import("pg").Pool;
}

/** Fetch responder that returns a canned response and remembers the call. */
function fakeFetcher(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    calls.push({ url: u, init: init ?? {} });
    return responder(u, init);
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("GoogleCalendarProvider.getFreeBusy", () => {
  const now = new Date("2026-05-14T12:00:00Z");
  const windowStart = new Date("2026-05-16T00:00:00Z");
  const windowEnd = new Date("2026-05-17T00:00:00Z");

  it("returns cached busy intervals when cache hit is fresh", async () => {
    const fetchSpy = fakeFetcher(() => {
      throw new Error("should not fetch on cache hit");
    });

    const pool = makePool([
      // pool.query for readFreeBusyCache: cached entry that's 5 min old by REAL Date.now()
      // (readFreeBusyCache compares against real Date.now() for TTL).
      {
        rows: [
          {
            busy_periods: [{ start: "2026-05-16T10:00:00Z", end: "2026-05-16T12:00:00Z" }],
            fetched_at: new Date(Date.now() - 5 * 60_000),
          },
        ],
      },
    ]);

    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    const result = await provider.getFreeBusy({ userId: USER_ID, windowStart, windowEnd });
    expect(result).toEqual([
      { start: new Date("2026-05-16T10:00:00Z"), end: new Date("2026-05-16T12:00:00Z") },
    ]);
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("fetches when cache is empty and token is still valid", async () => {
    const fetchSpy = fakeFetcher((url) => {
      if (url.includes("freeBusy")) {
        return new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [{ start: "2026-05-16T14:00:00Z", end: "2026-05-16T15:00:00Z" }],
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const validToken = {
      id: "tok-id",
      user_id: USER_ID,
      provider: "google" as const,
      scope: "freebusy" as const,
      encrypted_access_token: Buffer.from("ya29.valid-access", "utf8"),
      encrypted_refresh_token: Buffer.from("refresh-1", "utf8"),
      expires_at: new Date(now.getTime() + 30 * 60_000), // 30 min from now
      created_at: now,
      updated_at: now,
    };

    const pool = makePool([
      { rows: [] }, // cache miss
      {}, // BEGIN
      { rows: [validToken] }, // SELECT calendar_tokens FOR UPDATE
      {}, // COMMIT
      {}, // free_busy_cache write
    ]);

    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    const result = await provider.getFreeBusy({ userId: USER_ID, windowStart, windowEnd });
    expect(result).toEqual([
      { start: new Date("2026-05-16T14:00:00Z"), end: new Date("2026-05-16T15:00:00Z") },
    ]);
    expect(fetchSpy.calls).toHaveLength(1);
    expect(fetchSpy.calls[0]?.url).toContain("freeBusy");
    // The Bearer token sent in the Authorization header should be the
    // plaintext we encrypted above (round-tripped through fakeVault).
    expect(fetchSpy.calls[0]?.init?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer ya29.valid-access" }),
    );
  });

  it("refreshes the token eagerly when it expires within 60s", async () => {
    let refreshCalled = false;
    const fetchSpy = fakeFetcher((url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        refreshCalled = true;
        return new Response(
          JSON.stringify({
            access_token: "ya29.refreshed",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar.freebusy",
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }
      if (url.includes("freeBusy")) {
        return new Response(
          JSON.stringify({ calendars: { primary: { busy: [] } } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const nearExpiryToken = {
      id: "tok-id",
      user_id: USER_ID,
      provider: "google" as const,
      scope: "freebusy" as const,
      encrypted_access_token: Buffer.from("ya29.about-to-expire", "utf8"),
      encrypted_refresh_token: Buffer.from("refresh-rotating", "utf8"),
      expires_at: new Date(now.getTime() + 30_000), // 30s — inside refresh margin
      created_at: now,
      updated_at: now,
    };

    const pool = makePool([
      { rows: [] }, // cache miss
      {}, // BEGIN
      { rows: [nearExpiryToken] }, // SELECT FOR UPDATE
      // saveCalendarToken upsert; returns the saved row
      { rows: [{ ...nearExpiryToken, encrypted_access_token: Buffer.from("ya29.refreshed", "utf8") }] },
      {}, // COMMIT
      {}, // cache write
    ]);

    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    await provider.getFreeBusy({ userId: USER_ID, windowStart, windowEnd });
    expect(refreshCalled).toBe(true);

    const freeBusyCall = fetchSpy.calls.find((c) => c.url.includes("freeBusy"));
    expect(freeBusyCall?.init?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer ya29.refreshed" }),
    );
  });

  it("throws GoogleNotConnectedError when no token row exists for the user", async () => {
    const fetchSpy = fakeFetcher(() => {
      throw new Error("should not fetch when no token");
    });

    const pool = makePool([
      { rows: [] }, // cache miss
      {}, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE returns nothing
      {}, // COMMIT (after the empty SELECT)
    ]);

    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    await expect(
      provider.getFreeBusy({ userId: USER_ID, windowStart, windowEnd }),
    ).rejects.toBeInstanceOf(GoogleNotConnectedError);
  });

  it("throws GoogleReauthRequiredError when refresh fails", async () => {
    const fetchSpy = fakeFetcher((url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const expiredToken = {
      id: "tok-id",
      user_id: USER_ID,
      provider: "google" as const,
      scope: "freebusy" as const,
      encrypted_access_token: Buffer.from("ya29.expired", "utf8"),
      encrypted_refresh_token: Buffer.from("refresh-revoked", "utf8"),
      expires_at: new Date(now.getTime() - 60_000),
      created_at: now,
      updated_at: now,
    };

    const pool = makePool([
      { rows: [] }, // cache miss
      {}, // BEGIN
      { rows: [expiredToken] }, // SELECT FOR UPDATE
      // ROLLBACK
    ]);

    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    await expect(
      provider.getFreeBusy({ userId: USER_ID, windowStart, windowEnd }),
    ).rejects.toBeInstanceOf(GoogleReauthRequiredError);
  });

  it("forwards the AbortSignal to the underlying fetch", async () => {
    let sawSignal: AbortSignal | undefined;
    const fetchSpy = fakeFetcher((url, init) => {
      if (url.includes("freeBusy")) {
        sawSignal = init?.signal as AbortSignal | undefined;
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const validToken = {
      id: "tok-id",
      user_id: USER_ID,
      provider: "google" as const,
      scope: "freebusy" as const,
      encrypted_access_token: Buffer.from("ya29.valid", "utf8"),
      encrypted_refresh_token: Buffer.from("rt", "utf8"),
      expires_at: new Date(now.getTime() + 600_000),
      created_at: now,
      updated_at: now,
    };

    const pool = makePool([
      { rows: [] }, // cache miss
      {}, // BEGIN
      { rows: [validToken] }, // SELECT FOR UPDATE
      {}, // COMMIT
      {}, // cache write
    ]);

    const controller = new AbortController();
    const provider = new GoogleCalendarProvider({
      pool,
      vault: fakeVault,
      oauthConfig,
      fetchImpl: fetchSpy.fetch,
      now: () => now,
    });

    await provider.getFreeBusy({
      userId: USER_ID,
      windowStart,
      windowEnd,
      signal: controller.signal,
    });

    expect(sawSignal).toBe(controller.signal);
  });
});
