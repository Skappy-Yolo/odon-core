/**
 * Adds members to existing sessions. Used by the deep-link join flow
 * (`/start <short_code>` in a DM): a user taps the bot's invite link,
 * lands in a 1:1 chat with the bot pre-filled with the session's
 * short_code, and the bot adds them as a session_member.
 *
 * Returns enough info for the caller (the command router) to decide
 * what to reply: did the user just join? Are they already connected?
 * Do they still need to OAuth their calendar?
 */

import type { IncomingMessage } from "../core/contract.js";
import type { Queryable } from "../db/queries.js";
import {
  addSessionMember,
  findSessionByShortCode,
  upsertUser,
} from "../db/queries.js";
import type { GroupRow, SessionRow, UserRow } from "../db/types.js";

export interface JoinByShortCodeDeps {
  readonly db: Queryable;
}

export interface JoinByShortCodeInput {
  readonly message: IncomingMessage;
  readonly shortCode: string;
}

export type JoinOutcome =
  | { readonly kind: "session_not_found" }
  | { readonly kind: "session_not_open" }
  | {
      readonly kind: "joined";
      readonly session: SessionRow;
      readonly user: UserRow;
      readonly group: GroupRow | null;
      readonly memberStatus: "pending" | "connected" | "declined";
    };

export async function joinSessionByShortCode(
  deps: JoinByShortCodeDeps,
  input: JoinByShortCodeInput,
): Promise<JoinOutcome> {
  const session = await findSessionByShortCode(deps.db, input.shortCode);
  if (!session) return { kind: "session_not_found" };
  if (session.status !== "open") return { kind: "session_not_open" };

  const user = await upsertUser(deps.db, {
    rail: input.message.user.rail,
    platformUserId: input.message.user.platformUserId,
    displayName: input.message.user.displayName,
  });

  const member = await addSessionMember(deps.db, {
    sessionId: session.id,
    userId: user.id,
  });

  return {
    kind: "joined",
    session,
    user,
    group: null, // The group lives on the session, not on the join event; orchestrator can fetch it later if needed.
    memberStatus: member.status,
  };
}
