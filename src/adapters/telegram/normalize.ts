import type { IncomingGroup, IncomingMessage, IncomingUser } from "../../core/contract.js";
import type { TelegramMessage, TelegramUpdate } from "./types.js";

const RAIL = "telegram" as const;

/**
 * Convert a Telegram update to our IncomingMessage shape.
 *
 * Returns null when the update doesn't carry anything the engine handles
 * yet (callback queries, edited messages, channel posts, etc). The
 * caller (webhook handler) acks with 200 OK in that case — we want
 * Telegram to stop retrying — but does no further work.
 *
 * Pure function. No I/O. No DB lookups. The engine resolves opaque IDs
 * downstream of this layer.
 */
export function normalizeTelegramUpdate(update: TelegramUpdate): IncomingMessage | null {
  const message = update.message;
  if (!message) return null;
  if (!message.text) return null;
  if (!message.from) return null;
  if (message.from.is_bot) return null;

  const user = toIncomingUser(message);
  if (!user) return null;

  const group = toIncomingGroup(message);

  return {
    rail: RAIL,
    receivedAt: new Date(message.date * 1000),
    user,
    group,
    text: message.text,
    raw: update,
  };
}

function toIncomingUser(message: TelegramMessage): IncomingUser | null {
  const from = message.from;
  if (!from) return null;

  return {
    rail: RAIL,
    platformUserId: String(from.id),
    displayName: composeDisplayName(from.first_name, from.last_name) || from.username || String(from.id),
  };
}

function toIncomingGroup(message: TelegramMessage): IncomingGroup | null {
  const chat = message.chat;
  if (chat.type === "private") return null;

  return {
    rail: RAIL,
    platformGroupId: String(chat.id),
    displayName: chat.title ?? `Group ${chat.id}`,
  };
}

function composeDisplayName(first: string, last?: string): string {
  if (last && last.trim().length > 0) {
    return `${first} ${last}`.trim();
  }
  return first.trim();
}
