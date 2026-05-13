/**
 * Concrete SQL queries against the schema in migrations/0001_init.sql.
 *
 * No ORM. Parameterized queries via pg. Each function takes a pool (or
 * client) so callers can pass a transaction-bound client when they want
 * multiple queries inside one transaction.
 */

import type { Pool, PoolClient } from "pg";
import type {
  GroupRow,
  RailId,
  SessionRow,
  SessionStatus,
  UserRow,
} from "./types.js";

export type Queryable = Pool | PoolClient;

export interface UpsertUserInput {
  readonly rail: RailId;
  readonly platformUserId: string;
  readonly displayName: string;
  readonly timezone?: string | null;
}

/**
 * Insert a user if `(rail, platform_user_id)` is new, otherwise refresh the
 * display name and timezone. Always returns the resulting row.
 */
export async function upsertUser(q: Queryable, input: UpsertUserInput): Promise<UserRow> {
  const result = await q.query<UserRow>(
    `INSERT INTO users (rail, platform_user_id, display_name, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (rail, platform_user_id)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       timezone = COALESCE(EXCLUDED.timezone, users.timezone),
       updated_at = now()
     RETURNING *`,
    [input.rail, input.platformUserId, input.displayName, input.timezone ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error("upsertUser: no row returned");
  return row;
}

export interface UpsertGroupInput {
  readonly rail: RailId;
  readonly platformGroupId: string;
  readonly displayName: string;
}

export async function upsertGroup(q: Queryable, input: UpsertGroupInput): Promise<GroupRow> {
  const result = await q.query<GroupRow>(
    `INSERT INTO groups (rail, platform_group_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (rail, platform_group_id)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       updated_at = now()
     RETURNING *`,
    [input.rail, input.platformGroupId, input.displayName],
  );
  const row = result.rows[0];
  if (!row) throw new Error("upsertGroup: no row returned");
  return row;
}

export interface CreateSessionInput {
  readonly shortCode: string;
  readonly groupId: string;
  readonly initiatorUserId: string;
  readonly label: string;
  readonly deadline: Date;
  readonly passwordHash?: string | null;
}

export async function createSession(
  q: Queryable,
  input: CreateSessionInput,
): Promise<SessionRow> {
  const result = await q.query<SessionRow>(
    `INSERT INTO sessions (short_code, group_id, initiator_user_id, label, deadline, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.shortCode,
      input.groupId,
      input.initiatorUserId,
      input.label,
      input.deadline,
      input.passwordHash ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("createSession: no row returned");
  return row;
}

export async function findSessionByShortCode(
  q: Queryable,
  shortCode: string,
): Promise<SessionRow | null> {
  const result = await q.query<SessionRow>(
    "SELECT * FROM sessions WHERE short_code = $1",
    [shortCode],
  );
  return result.rows[0] ?? null;
}

export async function updateSessionStatus(
  q: Queryable,
  sessionId: string,
  status: SessionStatus,
): Promise<void> {
  await q.query(
    "UPDATE sessions SET status = $1, updated_at = now() WHERE id = $2",
    [status, sessionId],
  );
}
