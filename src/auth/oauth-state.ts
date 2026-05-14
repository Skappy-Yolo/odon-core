/**
 * Signed state parameter for the OAuth flow.
 *
 * What we want from the state:
 *   1. Carry the session_member_id from /oauth/google/start to /callback.
 *   2. Detect tampering (CSRF), so an attacker can't trick a user into
 *      connecting their calendar against someone else's session_member.
 *   3. Expire on its own, so a stale state from yesterday can't be replayed.
 *
 * Implementation: payload || "." || HMAC(payload, key)
 *   payload = base64url(JSON({ sid, exp, nonce }))
 *
 * No DB round-trip on either side. The HMAC is verified in constant time.
 * Expiry is a UNIX timestamp; we reject any state with `exp < now`.
 *
 * Same key as the token vault (TOKEN_ENCRYPTION_KEY decoded base64). The
 * key is used here as an HMAC key — separate algorithm domains so the
 * reuse is fine, but if we ever want explicit separation, derive two
 * subkeys with HKDF.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 10 * 60;

export interface OAuthStatePayload {
  /** session_member compound key, encoded as `sessionId:userId`. */
  readonly sid: string;
  /** UNIX seconds. */
  readonly exp: number;
  /** Random nonce for entropy / uniqueness. */
  readonly nonce: string;
}

export interface SignedOAuthState {
  readonly token: string;
}

export interface OAuthStateSigner {
  sign(sid: string, options?: { ttlSeconds?: number }): SignedOAuthState;
  verify(token: string): OAuthStatePayload;
}

export function createOAuthStateSigner(masterKeyB64: string): OAuthStateSigner {
  if (!masterKeyB64) throw new Error("createOAuthStateSigner: master key is empty");
  const key = Buffer.from(masterKeyB64, "base64");

  return {
    sign(sid: string, options): SignedOAuthState {
      const ttl = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
      const payload: OAuthStatePayload = {
        sid,
        exp: Math.floor(Date.now() / 1000) + ttl,
        nonce: randomBytes(8).toString("base64url"),
      };
      const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const sig = hmacB64(key, payloadB64);
      return { token: `${payloadB64}.${sig}` };
    },
    verify(token: string): OAuthStatePayload {
      const parts = token.split(".");
      if (parts.length !== 2) throw new Error("verify: malformed state token");
      const payloadB64 = parts[0] as string;
      const sig = parts[1] as string;
      const expected = hmacB64(key, payloadB64);
      const a = Buffer.from(sig, "base64url");
      const b = Buffer.from(expected, "base64url");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("verify: signature mismatch");
      }
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as OAuthStatePayload;
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("verify: state expired");
      }
      return payload;
    },
  };
}

function hmacB64(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}
