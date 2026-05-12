/**
 * Command router for Telegram messages.
 *
 * Parses the leading slash command from `message.text` and dispatches to
 * a handler. Returns an OutgoingMessage to be sent as a reply, or null
 * if the message is not a command we handle (still acks the webhook,
 * just doesn't reply).
 *
 * The router is intentionally dumb: parse the command, route, hand off.
 * Real product logic (session creation, overlap detection, calendar
 * connection) lives in the orchestrator and is wired in a follow-up
 * commit. This commit only wires `/start`; the rest reply with a stub
 * so a user typing `/find_time` sees something rather than silence.
 */

import type {
  IncomingMessage,
  OutgoingMessage,
} from "../../core/contract.js";

export type CommandName = "start" | "find_time" | "where" | "confirm" | "help";

const KNOWN: ReadonlyArray<CommandName> = ["start", "find_time", "where", "confirm", "help"];

export interface ParsedCommand {
  readonly name: CommandName;
  readonly rest: string;
}

/**
 * Extracts the command name from a message body. Returns null if the
 * message does not start with `/`, or if the command is not one we
 * recognise. Strips bot mentions like `/start@OdonBot` to just `/start`.
 */
export function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith("/")) return null;
  const firstSpace = text.indexOf(" ");
  const head = firstSpace === -1 ? text : text.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : text.slice(firstSpace + 1).trim();

  // Strip `@BotName` suffix from the command head.
  const atIndex = head.indexOf("@");
  const rawName = atIndex === -1 ? head.slice(1) : head.slice(1, atIndex);
  const candidate = rawName.toLowerCase();

  if (!(KNOWN as ReadonlyArray<string>).includes(candidate)) return null;
  return { name: candidate as CommandName, rest };
}

/**
 * Routes a normalized message to a command handler. Returns the reply
 * the bot should send, or null if nothing should be said. The router
 * never throws on unknown / non-command messages: those simply return
 * null and let the webhook ack 200.
 */
export function routeCommand(message: IncomingMessage): OutgoingMessage | null {
  const parsed = parseCommand(message.text);
  if (!parsed) return null;

  switch (parsed.name) {
    case "start":
      return startReply(message);
    case "help":
      return helpReply(message);
    case "find_time":
    case "where":
    case "confirm":
      return stubReply(message, parsed.name);
  }
}

function startReply(message: IncomingMessage): OutgoingMessage {
  const greeting = message.user.displayName ? `Hi ${message.user.displayName}.` : "Hi.";
  const body = [
    greeting,
    "",
    "I'm Odon. I help friend groups find times to hang out.",
    "",
    "What I can do today:",
    "  /find_time <thing> — start a hangout request in this group",
    "  /where <area>      — suggest venues for the next confirmed time",
    "  /confirm <choice>  — lock in a time the group voted for",
    "  /help              — show this again",
    "",
    "Privacy: I only read free/busy from calendars, never event titles.",
    "Source + how it works: github.com/Skappy-Yolo/odon-core",
  ].join("\n");

  return {
    target: targetFor(message),
    text: body,
  };
}

function helpReply(message: IncomingMessage): OutgoingMessage {
  return startReply(message);
}

function stubReply(message: IncomingMessage, command: CommandName): OutgoingMessage {
  return {
    target: targetFor(message),
    text: `\`/${command}\` is scaffolded but not wired to the session orchestrator yet. Coming next.`,
  };
}

function targetFor(message: IncomingMessage): OutgoingMessage["target"] {
  if (message.group) {
    return {
      kind: "group",
      rail: "telegram",
      platformGroupId: message.group.platformGroupId,
    };
  }
  return {
    kind: "user",
    rail: "telegram",
    platformUserId: message.user.platformUserId,
  };
}
