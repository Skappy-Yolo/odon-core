/**
 * Short-code generator for session invite links.
 *
 * The code goes into URLs like:
 *   wa.me/<bot>?text=join_<short_code>
 *   t.me/<bot>?start=<short_code>
 *   odon.gg/s/<short_code>  (redirect host)
 *
 * Requirements:
 * - URL-safe (no /, +, =, or characters that need percent-encoding)
 * - Short enough to share comfortably (8 chars at the alphabet below
 *   gives 56^8 = ~9.7 trillion codes, plenty for a long time)
 * - Avoids visually ambiguous characters (no 0/O/1/I/l) so users don't
 *   mistype when reading from a screenshot
 * - Cryptographically random, not predictable
 */

import { randomBytes } from "node:crypto";

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_LENGTH = 8;

export function generateShortCode(length: number = DEFAULT_LENGTH): string {
  if (length <= 0) throw new Error("generateShortCode: length must be positive");
  // Pull 2x the bytes we need so the modulo bias from uniform random sampling
  // doesn't visibly skew the alphabet. The alphabet is 56 chars; 256 mod 56
  // is 8, so a one-byte-per-char approach has a small bias. Generating extra
  // bytes and rejecting overflow values eliminates it.
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (const byte of buf) {
      if (out.length >= length) break;
      const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
      if (byte >= max) continue;
      const char = ALPHABET[byte % ALPHABET.length];
      if (char !== undefined) out.push(char);
    }
  }
  return out.join("");
}
