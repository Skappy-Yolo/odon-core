import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "../../src/auth/google-oauth.js";

const CONFIG: GoogleOAuthConfig = {
  clientId: "client-id-here",
  clientSecret: "client-secret-shh",
  redirectUri: "https://odon.gg/oauth/google/callback",
};

describe("buildAuthorizeUrl", () => {
  it("includes the required OAuth params", () => {
    const url = new URL(buildAuthorizeUrl(CONFIG, "state-token"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id-here");
    expect(url.searchParams.get("redirect_uri")).toBe("https://odon.gg/oauth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-token");
  });

  it("requests only the freebusy scope, never events.readwrite", () => {
    const url = new URL(buildAuthorizeUrl(CONFIG, "state"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("calendar.freebusy");
    expect(scope).not.toContain("calendar.events");
  });

  it("forces consent so we get a refresh_token even on repeat auth", () => {
    const url = new URL(buildAuthorizeUrl(CONFIG, "state"));
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
});

describe("exchangeCodeForTokens", () => {
  it("parses a normal token response", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "ya29.abc",
          refresh_token: "1//refresh.xyz",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.freebusy",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const tokens = await exchangeCodeForTokens(CONFIG, "auth-code", fakeFetch);
    expect(tokens.accessToken).toBe("ya29.abc");
    expect(tokens.refreshToken).toBe("1//refresh.xyz");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when Google returns a non-2xx", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(exchangeCodeForTokens(CONFIG, "bad-code", fakeFetch)).rejects.toThrow(/HTTP 400/);
  });

  it("throws when the response is missing access_token", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ expires_in: 60 }), { status: 200 });
    await expect(exchangeCodeForTokens(CONFIG, "code", fakeFetch)).rejects.toThrow(
      /missing access_token/,
    );
  });

  it("tolerates a response with no refresh_token (returns null)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "ya29.abc", expires_in: 3600, scope: "freebusy" }),
        { status: 200 },
      );
    const tokens = await exchangeCodeForTokens(CONFIG, "code", fakeFetch);
    expect(tokens.refreshToken).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("returns a new access token + same refresh_token when Google doesn't rotate", async () => {
    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = (init?.body ?? "") as string;
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=stored-rt");
      return new Response(
        JSON.stringify({
          access_token: "ya29.new-access",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.freebusy",
          token_type: "Bearer",
        }),
        { status: 200 },
      );
    };
    const tokens = await refreshAccessToken(CONFIG, "stored-rt", fakeFetch);
    expect(tokens.accessToken).toBe("ya29.new-access");
    expect(tokens.refreshToken).toBeNull(); // Google didn't return a new one
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("captures a rotated refresh_token when Google sends one", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "ya29.new-access",
          refresh_token: "1//rotated-rt",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    const tokens = await refreshAccessToken(CONFIG, "old-rt", fakeFetch);
    expect(tokens.refreshToken).toBe("1//rotated-rt");
  });

  it("throws on Google 400 invalid_grant (refresh_token revoked)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(refreshAccessToken(CONFIG, "bad-rt", fakeFetch)).rejects.toThrow(/HTTP 400/);
  });

  it("throws when Google omits access_token from the response", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ expires_in: 60 }), { status: 200 });
    await expect(refreshAccessToken(CONFIG, "rt", fakeFetch)).rejects.toThrow(
      /missing access_token/,
    );
  });
});
