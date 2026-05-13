/**
 * Session orchestration: the top-level "user said /find_time" workflow.
 *
 * What this layer owns:
 * - resolving the IncomingUser / IncomingGroup into the engine's internal
 *   users / groups tables (upsert pattern)
 * - generating a unique short code for the session
 * - inserting the session row
 * - returning a structured CreatedSession that adapters can format into
 *   their rail's preferred reply shape
 *
 * What this layer does NOT own:
 * - calendar OAuth (Phase 1+, per-user opt-in flow lives in src/auth)
 * - quorum / deadline orchestration (Phase 1+, runs as a cron job)
 * - the LLM call to rank times (lives behind the dispatcher)
 * - the actual reply text (adapter responsibility, per the architecture)
 */

import type { IncomingMessage } from "../core/contract.js";
import type { Queryable } from "../db/queries.js";
import {
  createSession,
  findSessionByShortCode,
  upsertGroup,
  upsertUser,
} from "../db/queries.js";
import type { GroupRow, SessionRow, UserRow } from "../db/types.js";
import { generateShortCode } from "./short-code.js";

export interface CreateSessionDeps {
  /** A pg Pool or PoolClient. The orchestrator does not own its DB; it accepts one. */
  readonly db: Queryable;
  /** Override for tests; defaults to generateShortCode(). */
  readonly genShortCode?: () => string;
  /** Override for tests; defaults to new Date(). */
  readonly now?: () => Date;
}

export interface CreateSessionFromMessageInput {
  readonly message: IncomingMessage;
  /** Free-text label, e.g. "movie this weekend". */
  readonly label: string;
  /** Hours until the session deadline. Defaults to 24. */
  readonly deadlineHours?: number;
}

export interface CreatedSession {
  readonly session: SessionRow;
  readonly initiator: UserRow;
  readonly group: GroupRow | null;
}

/**
 * The /find_time handler ends here. Returns the row written to the
 * sessions table plus the resolved initiator and group, so the adapter
 * can compose a reply that references them.
 *
 * Throws if:
 * - the incoming message has no group (sessions only live in groups for now)
 * - the short code collides three times in a row (effectively impossible
 *   at 56^8, but guarded anyway)
 */
export async function createSessionFromMessage(
  deps: CreateSessionDeps,
  input: CreateSessionFromMessageInput,
): Promise<CreatedSession> {
  const { message, label } = input;
  if (!message.group) {
    throw new Error("createSessionFromMessage: cannot create a session outside a group");
  }
  if (label.trim().length === 0) {
    throw new Error("createSessionFromMessage: label is required");
  }

  const initiator = await upsertUser(deps.db, {
    rail: message.user.rail,
    platformUserId: message.user.platformUserId,
    displayName: message.user.displayName,
  });
  const group = await upsertGroup(deps.db, {
    rail: message.group.rail,
    platformGroupId: message.group.platformGroupId,
    displayName: message.group.displayName,
  });

  const now = deps.now?.() ?? new Date();
  const deadlineHours = input.deadlineHours ?? 24;
  const deadline = new Date(now.getTime() + deadlineHours * 60 * 60_000);

  const genCode = deps.genShortCode ?? generateShortCode;
  const shortCode = await pickUniqueShortCode(deps.db, genCode, 3);

  const session = await createSession(deps.db, {
    shortCode,
    groupId: group.id,
    initiatorUserId: initiator.id,
    label: label.trim(),
    deadline,
  });

  return { session, initiator, group };
}

async function pickUniqueShortCode(
  q: Queryable,
  gen: () => string,
  attempts: number,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = gen();
    const existing = await findSessionByShortCode(q, code);
    if (!existing) return code;
  }
  throw new Error("pickUniqueShortCode: failed to find a unique short code after retries");
}
