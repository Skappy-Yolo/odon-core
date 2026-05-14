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
import { findGroupByPlatform, findOpenSessionForGroup } from "../../db/queries.js";
import type { FreeBusyProvider } from "../../llm/dispatcher.js";
import { proposeTimesHandler } from "../../llm/handlers/propose-times.js";
import type { Pool } from "pg";

export type CommandName = "start" | "find_time" | "where" | "confirm" | "help" | "proceed";

const KNOWN: ReadonlyArray<CommandName> = [
  "start",
  "find_time",
  "where",
  "confirm",
  "help",
  "proceed",
];

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
    case "proceed":
      return stubReply(message, parsed.name);
  }
}

export interface CommandRouterDeps {
  readonly orchestrator: CreateSessionDeps;
  readonly googleConfig: GoogleOAuthConfig;
  readonly stateSigner: OAuthStateSigner;
  /** Used to build t.me/<botUsername>?start=<short_code> join links. */
  readonly botUsername?: string;
  /**
   * Free/busy providers used by /proceed when calling propose_times.
   * Optional so a dev build without DB/OAuth still wires the router
   * (commands that don't need providers still work).
   */
  readonly providers?: Readonly<Record<string, FreeBusyProvider>>;
  /** Token vault used inside propose_times' provider path. */
  readonly vault?: import("../../auth/token-vault.js").TokenVault;
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
      case "proceed":
        return proceedReply(deps, message);
      case "where":
      case "confirm":
        return stubReply(message, parsed.name);
    }
  };
}

/**
 * Handler for `/proceed`: pulls real free/busy for every connected member
 * of the current group's open session and replies with the top time
 * windows. No voting yet; that lands in 3.b. /proceed today is a manual
 * trigger so we can verify the real provider works end-to-end before
 * adding the inline-keyboard surface.
 */
async function proceedReply(
  deps: CommandRouterDeps,
  message: IncomingMessage,
): Promise<OutgoingMessage> {
  if (!message.group) {
    return {
      target: targetFor(message),
      text: "Run /proceed inside a group, not in a DM. /proceed acts on the group's open session.",
    };
  }

  // Look up the engine's group row and its open session.
  const db = deps.orchestrator.db as Pool;
  const group = await findGroupByPlatform(db, message.group.rail, message.group.platformGroupId);
  if (!group) {
    return {
      target: targetFor(message),
      text: "I haven't seen this group yet. Run /find_time first to start a session.",
    };
  }
  const session = await findOpenSessionForGroup(db, group.id);
  if (!session) {
    return {
      target: targetFor(message),
      text: "No open session in this group. Start one with /find_time.",
    };
  }

  // Build a DispatchContext and call propose_times directly. The
  // dispatcher's auth + budget + audit machinery would also work, but
  // /proceed is a deterministic user-triggered action (not LLM-driven),
  // so going through the dispatcher would be ceremony without payoff.
  // The dispatcher comes back into the picture when the LLM is wired
  // for /find_time-style natural-language coordination.
  const ctx = {
    callerId: message.user.platformUserId,
    sessionId: session.id,
    rail: message.rail,
    db,
    ...(deps.vault ? { vault: deps.vault } : {}),
    ...(deps.providers ? { providers: deps.providers } : {}),
  };
  const args = {
    sessionId: session.id,
    topN: 3,
    minFreeCount: 2,
  };

  let result;
  try {
    // proposeTimesHandler.authorize is sync-ish here (synchronous boolean);
    // we replicate the dispatcher's contract by checking it ourselves.
    if (!proposeTimesHandler.authorize(ctx, args)) {
      throw new Error("/proceed: not authorized to compute times for this session");
    }
    result = await proposeTimesHandler.execute(ctx, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      target: targetFor(message),
      text: `Couldn't compute times: ${msg}`,
    };
  }

  if (result.windows.length === 0) {
    const unreachable = result.unreachableMemberIds.length;
    const unreachableNote =
      unreachable > 0
        ? `\n\n${unreachable} member${unreachable === 1 ? "'s" : "s'"} calendar I couldn't read (auth or transport issue).`
        : "";
    return {
      target: targetFor(message),
      text:
        `No windows where at least 2 of you are free in the next 7 days.${unreachableNote}\n\n` +
        `Either more people need to connect their calendar, or you have very different schedules. Try widening the window or coordinate manually for this one.`,
    };
  }

  const lines = [
    `<b>Top ${result.windows.length} time${result.windows.length === 1 ? "" : "s"} for "${escapeHtml(session.label)}":</b>`,
    "",
  ];
  result.windows.forEach((w, idx) => {
    const start = new Date(w.startIso);
    const end = new Date(w.endIso);
    lines.push(`<b>${idx + 1}.</b> ${formatWindow(start, end)}  (${w.freeCount} free)`);
  });
  if (result.unreachableMemberIds.length > 0) {
    lines.push("");
    lines.push(
      `<i>${result.unreachableMemberIds.length} member${result.unreachableMemberIds.length === 1 ? "'s" : "s'"} calendar couldn't be read this time — I'll DM them to reconnect.</i>`,
    );
  }
  lines.push("");
  lines.push("<i>Voting buttons land in the next commit; for now reply /confirm &lt;N&gt; to lock one in.</i>");

  return {
    target: targetFor(message),
    text: lines.join("\n"),
    format: "html",
  };
}

function formatWindow(start: Date, end: Date): string {
  // UTC, day + hour. Per-user timezones land later.
  const day = start.toUTCString().slice(0, 11); // "Sat, 16 May"
  const startHour = start.toUTCString().slice(17, 22); // "19:00"
  const endHour = end.toUTCString().slice(17, 22);
  return `${day} ${startHour}–${endHour} UTC`;
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
    const reply = composeSessionCreatedReply(result, deps.botUsername);
    return {
      target: targetFor(message),
      text: reply.text,
      format: reply.format,
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

  const label = escapeHtml(outcome.session.label);
  const lines = [
    `Joined "<b>${label}</b>".`,
    "",
    "Connect your Google Calendar so I can find times that work for the group. I only read free/busy windows, never your event titles, attendees, or locations.",
    "",
    `<a href="${authorizeUrl}">Click here to connect your Google Calendar →</a>`,
    "",
    "<i>If you use Outlook or iCloud instead of Google, those providers are coming in follow-up commits.</i>",
  ];
  return { target: targetFor(message), text: lines.join("\n"), format: "html" };
}

function composeSessionCreatedReply(
  result: {
    session: { short_code: string; label: string; deadline: Date };
    group: { display_name: string } | null;
  },
  botUsername?: string,
): { text: string; format: "html" } {
  const { session, group } = result;
  const label = escapeHtml(session.label);
  const groupName = escapeHtml(group?.display_name ?? "this group");
  const deadline = escapeHtml(session.deadline.toUTCString());
  const code = escapeHtml(session.short_code);
  const lines = [
    `Created session "<b>${label}</b>" for <b>${groupName}</b>.`,
    `Code: <code>${code}</code>`,
    `Deadline: ${deadline}`,
  ];
  if (botUsername) {
    const joinUrl = `https://t.me/${botUsername}?start=${session.short_code}`;
    lines.push(
      "",
      `<a href="${joinUrl}">Tap to join + connect your calendar →</a>`,
    );
  } else {
    lines.push(
      "",
      `Members DM me <code>/start ${code}</code> to join.`,
    );
  }
  lines.push(
    "",
    "<i>Once enough of you connect, I'll propose times that work for everyone.</i>",
  );
  return { text: lines.join("\n"), format: "html" };
}

/** Minimal HTML escaping for Telegram's parse_mode=HTML body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
