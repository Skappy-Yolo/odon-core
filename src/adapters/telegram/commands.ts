/**
 * Command router for Telegram messages.
 *
 * Two variants:
 * - routeCommand(message) — sync, returns stub replies for unwired commands.
 *   Useful for tests that don't need the orchestrator.
 * - createCommandRouter(deps) — returns an async router that wires
 *   /find_time to the session orchestrator, /start <code> to the
 *   deep-link join flow, and produces the Google OAuth DM.
 */

import type {
  IncomingMessage,
  OutgoingMessage,
} from "../../core/contract.js";
import {
  createSessionFromMessage,
  joinSessionByShortCode,
  type CreateSessionDeps,
} from "../../orchestrator/index.js";
import type { GoogleOAuthConfig } from "../../auth/google-oauth.js";
import type { OAuthStateSigner } from "../../auth/oauth-state.js";
import { buildAuthorizeUrl } from "../../auth/google-oauth.js";

export type CommandName = "start" | "find_time" | "where" | "confirm" | "help";

const KNOWN: ReadonlyArray<CommandName> = ["start", "find_time", "where", "confirm", "help"];

export interface ParsedCommand {
  readonly name: CommandName;
  readonly rest: string;
}

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

/** Sync stub router (for tests / DB-less dev). */
export function routeCommand(message: IncomingMessage): OutgoingMessage | null {
  const parsed = parseCommand(message.text);
  if (!parsed) return null;

  switch (parsed.name) {
    case "start":
      // Sync path doesn't handle deep-link join (that needs the orchestrator).
      // If there's a short_code in /start, the production router below
      // wires it; here we just show the welcome.
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
  readonly googleConfig: GoogleOAuthConfig;
  readonly stateSigner: OAuthStateSigner;
  /** Used to build t.me/<botUsername>?start=<short_code> join links. */
  readonly botUsername?: string;
}

export function createCommandRouter(deps: CommandRouterDeps) {
  return async function route(message: IncomingMessage): Promise<OutgoingMessage | null> {
    const parsed = parseCommand(message.text);
    if (!parsed) return null;

    switch (parsed.name) {
      case "start":
        if (parsed.rest.length > 0) {
          return joinDeepLinkReply(deps, message, parsed.rest);
        }
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

/**
 * Triggered by Telegram's deep-link mechanism: user taps
 * `https://t.me/<bot>?start=<code>` and Telegram sends `/start <code>`.
 *
 * Looks up the session, adds the user as a session_member, replies with
 * a Google OAuth URL the user can tap to connect their calendar.
 */
async function joinDeepLinkReply(
  deps: CommandRouterDeps,
  message: IncomingMessage,
  shortCode: string,
): Promise<OutgoingMessage> {
  const code = shortCode.trim();
  let outcome;
  try {
    outcome = await joinSessionByShortCode(deps.orchestrator, { message, shortCode: code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { target: targetFor(message), text: `Couldn't join: ${msg}` };
  }

  if (outcome.kind === "session_not_found") {
    return {
      target: targetFor(message),
      text: `No open session with code "${code}". Ask the person who started it to share the link again.`,
    };
  }
  if (outcome.kind === "session_not_open") {
    return {
      target: targetFor(message),
      text: `That session is no longer open. Start a fresh one with /find_time in your group.`,
    };
  }

  // outcome.kind === "joined"
  if (outcome.memberStatus === "connected") {
    return {
      target: targetFor(message),
      text: `You're already connected to "${outcome.session.label}". Sit tight; I'll post when there's a result.`,
    };
  }

  const state = deps.stateSigner.sign(`${outcome.session.id}:${outcome.user.id}`);
  const authorizeUrl = buildAuthorizeUrl(deps.googleConfig, state.token);

  const lines = [
    `Joined "${outcome.session.label}".`,
    "",
    "Connect your Google Calendar so I can find times that work for the group. I only read free/busy windows, never your event titles, attendees, or locations.",
    "",
    authorizeUrl,
    "",
    "(If you use Outlook or iCloud instead of Google, those providers are coming in follow-up commits.)",
  ];
  return { target: targetFor(message), text: lines.join("\n") };
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
  const deadline = session.deadline.toUTCString();
  const lines = [
    `Created session "${session.label}" for ${groupName}.`,
    `Code: ${session.short_code}`,
    `Deadline: ${deadline}`,
  ];
  if (botUsername) {
    lines.push(
      "",
      `Members tap to join + connect their calendar:`,
      `https://t.me/${botUsername}?start=${session.short_code}`,
    );
  } else {
    lines.push(
      "",
      `Members DM me \`/start ${session.short_code}\` to join.`,
    );
  }
  lines.push(
    "",
    "Once enough of you connect, I'll propose times that work for everyone.",
  );
  return lines.join("\n");
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
