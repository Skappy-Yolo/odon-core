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
    scope: FREEBUSY_SCOPE,
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
    scope: json.scope ?? FREEBUSY_SCOPE,
  };
}
