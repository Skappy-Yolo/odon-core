/**
 * Telegram webhook signature verification.
 *
 * Telegram's webhook security model differs from Stripe / GitHub / Meta:
 * there is no HMAC. Instead, when you register the webhook with
 * setWebhook, you supply a secret token. Telegram echoes it back on
 * every update via the X-Telegram-Bot-Api-Secret-Token header.
 *
 * The adapter compares the received header to the expected token in
 * constant time (timing-attack safe). Anything else is dropped at the
 * edge before any work happens.
 *
 * Reference: https://core.telegram.org/bots/api#setwebhook
 */

import { timingSafeEqual } from "node:crypto";

const SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";

export interface VerifySignatureOptions {
  /** The secret token we registered with Telegram via setWebhook. */
  readonly expectedSecretToken: string;
}

/**
 * Returns true iff the incoming webhook carries the expected secret token.
 *
 * Header lookup is case-insensitive: Node lowercases incoming HTTP headers,
 * but defensive code shouldn't assume the caller already lowercased keys.
 */
export function verifyTelegramSignature(
  headers: Readonly<Record<string, string>>,
  options: VerifySignatureOptions,
): boolean {
  const expected = options.expectedSecretToken;
  if (!expected) return false;

  const received = pickHeader(headers, SECRET_TOKEN_HEADER);
  if (!received) return false;

  // Use Buffer + timingSafeEqual so an attacker can't probe one character
  // at a time by measuring response times.
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function pickHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const lowered = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowered) {
      return headers[key];
    }
  }
  return undefined;
}
