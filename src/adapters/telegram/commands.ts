/**
 * Command router for Telegram messages.
 *
 * Two variants:
 * - routeCommand(message) — sync, returns stub replies for unwired commands.
 *   Useful for tests that don't need the orchestrator.
 * - createCommandRouter(deps) — returns an async router that wires
 *   /find_time to the real session orchestrator. This is what src/index.ts
 *   uses in production when DB is configured.
 *
 * Parses the leading slash command from `message.text` and dispatches. Returns
 * an OutgoingMessage to be sent as a reply, or null if the message is not a
 * command we handle.
 */

import type {
  IncomingMessage,
  OutgoingMessage,
} from "../../core/contract.js";
import {
  createSessionFromMessage,
  type CreateSessionDeps,
} from "../../orchestrator/index.js";

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

  const atIndex = head.indexOf("@");
  const rawName = atIndex === -1 ? head.slice(1) : head.slice(1, atIndex);
  const candidate = rawName.toLowerCase();

  if (!(KNOWN as ReadonlyArray<string>).includes(candidate)) return null;
  return { name: candidate as CommandName, rest };
}

/**
 * Sync router: handles /start and /help with real replies, returns stub
 * replies for /find_time, /where, /confirm. Use this in tests; production
 * uses createCommandRouter.
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

export interface CommandRouterDeps {
  readonly orchestrator: CreateSessionDeps;
  /** Optional override for the bot's username, used to build the share link. */
  readonly botUsername?: string;
}

/**
 * Production router. /find_time now creates a real session via the
 * orchestrator. /start, /help, /where, /confirm behave the same as the
 * sync routeCommand for now.
 */
export function createCommandRouter(deps: CommandRouterDeps) {
  return async function route(message: IncomingMessage): Promise<OutgoingMessage | null> {
    const parsed = parseCommand(message.text);
    if (!parsed) return null;

    switch (parsed.name) {
      case "start":
        return startReply(message);
      case "help":
        return helpReply(message);
      case "find_time":
        return findTimeReply(deps, message, parsed.rest);
      case "where":
      case "confirm":
        return stubReply(message, parsed.name);
    }
  };
}

async function findTimeReply(
  deps: CommandRouterDeps,
  message: IncomingMessage,
  label: string,
): Promise<OutgoingMessage> {
  if (!message.group) {
    return {
      target: targetFor(message),
      text: "Run /find_time inside a group, not in a DM. The session is anchored to a group.",
    };
  }
  if (label.trim().length === 0) {
    return {
      target: targetFor(message),
      text: "Usage: /find_time <what for>\n\nExample: /find_time movie this weekend",
    };
  }

  try {
    const result = await createSessionFromMessage(deps.orchestrator, {
      message,
      label,
    });
    return {
      target: targetFor(message),
      text: composeSessionCreatedReply(result, deps.botUsername),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      target: targetFor(message),
      text: `Couldn't create the session: ${msg}`,
    };
  }
}

function composeSessionCreatedReply(
  result: {
    session: { short_code: string; label: string; deadline: Date };
    group: { display_name: string } | null;
  },
  botUsername?: string,
): string {
  const { session, group } = result;
  const groupName = group?.display_name ?? "this group";
  const deadline = formatDeadline(session.deadline);
  const lines = [
    `Created session "${session.label}" for ${groupName}.`,
    `Code: ${session.short_code}`,
    `Deadline: ${deadline}`,
  ];
  if (botUsername) {
    lines.push(
      "",
      `Share this link with the group:`,
      `https://t.me/${botUsername}?start=${session.short_code}`,
    );
  }
  lines.push(
    "",
    "Next step (coming): each member connects their calendar and the bot proposes times where most of you are free.",
  );
  return lines.join("\n");
}

function formatDeadline(d: Date): string {
  return d.toUTCString();
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
