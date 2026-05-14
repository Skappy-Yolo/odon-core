/**
 * OAuth callback routes. Currently Google only; Microsoft and iCloud
 * land in follow-up commits.
 *
 * Design (single-route flow):
 *   1. Bot DMs user a Google authorize URL with a signed `state` param
 *      that carries the session+user context.
 *   2. User taps, lands on Google's consent screen, approves.
 *   3. Google redirects to /oauth/google/callback?code=...&state=...
 *   4. This route verifies the state, exchanges the code for tokens,
 *      encrypts them, saves them, marks the session_member as connected,
 *      replies with a tiny HTML page telling the user to return to Telegram.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TokenVault } from "../auth/token-vault.js";
import type { OAuthStateSigner } from "../auth/oauth-state.js";
import type { GoogleOAuthConfig } from "../auth/google-oauth.js";
import { exchangeCodeForTokens } from "../auth/google-oauth.js";
import type { Queryable } from "../db/queries.js";
import {
  markSessionMemberConnected,
  saveCalendarToken,
} from "../db/queries.js";

export interface OAuthRoutesDeps {
  readonly db: Queryable;
  readonly googleConfig: GoogleOAuthConfig;
  readonly vault: TokenVault;
  readonly stateSigner: OAuthStateSigner;
}

export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthRoutesDeps): void {
  app.get(
    "/oauth/google/callback",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query as { code?: string; state?: string; error?: string }) ?? {};

      if (query.error) {
        req.log.info({ error: query.error }, "oauth/google: user declined or error");
        return reply.type("text/html").send(connectFailedHtml(query.error));
      }
      if (!query.code || !query.state) {
        return reply.code(400).type("text/html").send(connectFailedHtml("missing code or state"));
      }

      let sid: string;
      try {
        const payload = deps.stateSigner.verify(query.state);
        sid = payload.sid;
      } catch (err) {
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "oauth/google: state verification failed",
        );
        return reply.code(400).type("text/html").send(connectFailedHtml("invalid or expired state"));
      }

      const parsed = parseSid(sid);
      if (!parsed) {
        return reply.code(400).type("text/html").send(connectFailedHtml("malformed state payload"));
      }

      let tokens;
      try {
        tokens = await exchangeCodeForTokens(deps.googleConfig, query.code);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg }, "oauth/google: token exchange failed");
        return reply.code(502).type("text/html").send(connectFailedHtml("token exchange failed"));
      }

      try {
        await saveCalendarToken(deps.db, {
          userId: parsed.userId,
          provider: "google",
          scope: "freebusy",
          encryptedAccessToken: deps.vault.encrypt(tokens.accessToken),
          encryptedRefreshToken: tokens.refreshToken ? deps.vault.encrypt(tokens.refreshToken) : null,
          expiresAt: tokens.expiresAt,
        });
        await markSessionMemberConnected(deps.db, parsed.sessionId, parsed.userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg }, "oauth/google: db write failed");
        return reply.code(500).type("text/html").send(connectFailedHtml("storing your token failed"));
      }

      return reply.type("text/html").send(connectSucceededHtml());
    },
  );

  app.log.info("oauth routes registered at GET /oauth/google/callback");
}

function parseSid(sid: string): { sessionId: string; userId: string } | null {
  const parts = sid.split(":");
  if (parts.length !== 2) return null;
  const sessionId = parts[0];
  const userId = parts[1];
  if (!sessionId || !userId) return null;
  return { sessionId, userId };
}

function connectSucceededHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connected — Odon</title>
<style>
  body { font: 16px system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 48px 24px; }
  main { max-width: 480px; margin: 0 auto; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 16px; }
  p { color: #9da7b3; line-height: 1.5; margin: 0 0 12px; }
  small { color: #6e7681; }
</style>
</head><body><main>
<h1>Calendar connected</h1>
<p>Odon can now read your free/busy windows. Never your event titles, attendees, or locations.</p>
<p>Return to your Telegram conversation with the bot.</p>
<small>You can close this tab.</small>
</main></body></html>`;
}

function connectFailedHtml(reason: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Couldn't connect — Odon</title>
<style>
  body { font: 16px system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 48px 24px; }
  main { max-width: 480px; margin: 0 auto; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 16px; }
  p { color: #9da7b3; line-height: 1.5; margin: 0 0 12px; }
  code { background: #1f242c; padding: 4px 8px; border-radius: 4px; color: #e6edf3; font-size: 13px; }
</style>
</head><body><main>
<h1>Couldn't connect your calendar</h1>
<p>Reason: <code>${escapeHtml(reason)}</code></p>
<p>Return to Telegram and re-tap your join link to start over.</p>
</main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
