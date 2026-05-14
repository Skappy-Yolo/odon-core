import type { IncomingGroup, IncomingMessage, IncomingUser } from "../../core/contract.js";
import type { TelegramMessage, TelegramTgUser, TelegramUpdate } from "./types.js";

const RAIL = "telegram" as const;

/**
 * Convert a Telegram update to our IncomingMessage shape.
 *
 * Handles two kinds of update today:
 *   1. message updates with text — produces a "text" IncomingMessage
 *   2. callback_query updates (inline keyboard button presses) — produces
 *      a "callback" IncomingMessage with text="" and callback.data set
 *
 * Returns null for everything else (edited messages, channel posts, my_chat_member,
 * etc). The caller (webhook handler) acks with 200 OK in that case — we want
 * Telegram to stop retrying — but does no further work.
 *
 * Pure function. No I/O. No DB lookups. The engine resolves opaque IDs
 * downstream of this layer.
 */
export function normalizeTelegramUpdate(update: TelegramUpdate): IncomingMessage | null {
  if (update.callback_query) return normalizeCallbackQuery(update);
  return normalizeMessageUpdate(update);
}

function normalizeMessageUpdate(update: TelegramUpdate): IncomingMessage | null {
  const message = update.message;
  if (!message) return null;
  if (!message.text) return null;
  if (!message.from) return null;
  if (message.from.is_bot) return null;

  const user = userFromTg(message.from);
  const group = groupFromChat(message);

  return {
    rail: RAIL,
    receivedAt: new Date(message.date * 1000),
    user,
    group,
    text: message.text,
    raw: update,
  };
}

function normalizeCallbackQuery(update: TelegramUpdate): IncomingMessage | null {
  const cq = update.callback_query;
  if (!cq) return null;
  if (cq.from.is_bot) return null;
  if (!cq.data) return null; // callback_query without data is meaningless to us

  const user = userFromTg(cq.from);

  // The chat the button was pressed in (could be a group or the bot's DM
  // with the user). cq.message is the message that hosted the button.
  const group = cq.message ? groupFromChat(cq.message) : null;

  // receivedAt: Telegram doesn't provide a timestamp on the callback_query
  // itself. Use the moment we observed it (now), with a sub-second offset
  // from the host message so downstream ordering is stable when needed.
  const receivedAt = new Date();

  return {
    rail: RAIL,
    receivedAt,
    user,
    group,
    text: "",
    callback: {
      data: cq.data,
      queryId: cq.id,
    },
    raw: update,
  };
}

function userFromTg(from: TelegramTgUser): IncomingUser {
  return {
    rail: RAIL,
    platformUserId: String(from.id),
    displayName: composeDisplayName(from.first_name, from.last_name) || from.username || String(from.id),
  };
}

function groupFromChat(message: TelegramMessage): IncomingGroup | null {
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
