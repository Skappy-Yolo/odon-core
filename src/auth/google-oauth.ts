/**
 * Google OAuth 2.0 helper.
 *
 * Two functions:
 *   buildAuthorizeUrl(state) -> the URL we redirect users to
 *   exchangeCodeForTokens(code) -> { accessToken, refreshToken, expiresAt }
 *
 * Scope: calendar.freebusy ONLY. The /autoadd opt-in flow (future commit)
 * upgrades to calendar.events; until then, the bot cannot write to any
 * user's calendar. That's the engine's security promise made literal.
 */

const AUTHORIZE_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_BASE = "https://oauth2.googleapis.com/token";
const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const CALENDARLIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

/**
 * Scopes we request, narrowest possible to fulfil the product need:
 * - freebusy: read busy intervals only (no titles, attendees, locations)
 * - calendarlist.readonly: enumerate the user's calendars (name + id only,
 *   no event data) so we can query freebusy across ALL of their
 *   calendars instead of only `primary`. Without this, users with the
 *   common "primary + work + family" calendar setup get incorrect
 *   results: events on non-primary calendars are invisible.
 */
const SCOPES = [FREEBUSY_SCOPE, CALENDARLIST_SCOPE].join(" ");

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
  readonly scope: string;
}

export function buildAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Force consent so we always get a refresh_token, even when the
    // user already authorized us before. Skipping this is the #1 way
    // production OAuth implementations end up with no refresh token.
    prompt: "consent",
    state,
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetchImpl(TOKEN_BASE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google token exchange failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!json.access_token || !json.expires_in) {
    throw new Error("Google token exchange: missing access_token or expires_in");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope ?? SCOPES,
  };
}

/**
 * Refresh an access token using a stored refresh_token.
 *
 * Used by the free/busy provider when the stored access token is within
 * 60 seconds of expiring (eager refresh — we'd rather refresh slightly
 * early than retry on 401). The refresh_token usually stays the same
 * across refreshes, but Google occasionally rotates it; when the
 * response includes a new refresh_token we save that one.
 *
 * Throws on transport / auth errors. The caller decides whether to
 * mark the user's calendar as needing re-OAuth (when refresh itself
 * returns 400/401 with `invalid_grant`) or to just retry later
 * (transient 5xx).
 */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetchImpl(TOKEN_BASE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google token refresh failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!json.access_token || !json.expires_in) {
    throw new Error("Google token refresh: missing access_token or expires_in");
  }

  return {
    accessToken: json.access_token,
    // Google usually omits refresh_token on refresh; keep the one we had.
    // Callers fall back to the existing stored token when this is null.
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope ?? SCOPES,
  };
}
