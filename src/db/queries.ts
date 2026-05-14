/**
 * Concrete SQL queries against the schema in migrations/0001_init.sql.
 *
 * No ORM. Parameterized queries via pg. Each function takes a pool (or
 * client) so callers can pass a transaction-bound client when they want
 * multiple queries inside one transaction.
 */

import type { Pool, PoolClient } from "pg";
import type {
  CalendarProvider,
  CalendarScope,
  CalendarTokenRow,
  GroupRow,
  RailId,
  SessionMemberRow,
  SessionMemberStatus,
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

/**
 * Find the most-recently-created open session for a group, if any.
 * Used by `/proceed` to figure out which session the user is asking
 * about when they don't pass a short_code explicitly.
 */
export async function findOpenSessionForGroup(
  q: Queryable,
  groupId: string,
): Promise<SessionRow | null> {
  const result = await q.query<SessionRow>(
    `SELECT * FROM sessions
       WHERE group_id = $1 AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
    [groupId],
  );
  return result.rows[0] ?? null;
}

/**
 * Look up a group by its (rail, platform_group_id) compound key.
 * Returns null when the bot hasn't seen this group yet.
 */
export async function findGroupByPlatform(
  q: Queryable,
  rail: RailId,
  platformGroupId: string,
): Promise<GroupRow | null> {
  const result = await q.query<GroupRow>(
    "SELECT * FROM groups WHERE rail = $1 AND platform_group_id = $2",
    [rail, platformGroupId],
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

export interface AddSessionMemberInput {
  readonly sessionId: string;
  readonly userId: string;
}

/**
 * Add a user to a session if not already a member. Returns the resulting
 * row. Idempotent: re-adding the same user is a no-op (we just return
 * the existing row).
 */
export async function addSessionMember(
  q: Queryable,
  input: AddSessionMemberInput,
): Promise<SessionMemberRow> {
  const result = await q.query<SessionMemberRow>(
    `INSERT INTO session_members (session_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id, user_id) DO UPDATE
       SET joined_at = session_members.joined_at
     RETURNING *`,
    [input.sessionId, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("addSessionMember: no row returned");
  return row;
}

export async function getSessionMember(
  q: Queryable,
  sessionId: string,
  userId: string,
): Promise<SessionMemberRow | null> {
  const result = await q.query<SessionMemberRow>(
    "SELECT * FROM session_members WHERE session_id = $1 AND user_id = $2",
    [sessionId, userId],
  );
  return result.rows[0] ?? null;
}

export async function markSessionMemberConnected(
  q: Queryable,
  sessionId: string,
  userId: string,
): Promise<void> {
  await q.query(
    `UPDATE session_members
       SET status = 'connected', calendar_connected_at = now()
       WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
}

export interface SaveCalendarTokenInput {
  readonly userId: string;
  readonly provider: CalendarProvider;
  readonly scope: CalendarScope;
  readonly encryptedAccessToken: Buffer;
  readonly encryptedRefreshToken: Buffer | null;
  readonly expiresAt: Date | null;
}

/**
 * Save (or refresh) a user's encrypted OAuth token for a provider.
 * `(user_id, provider)` is unique; re-OAuth overwrites the row, which
 * is the behaviour we want when refresh tokens rotate.
 */
export async function saveCalendarToken(
  q: Queryable,
  input: SaveCalendarTokenInput,
): Promise<CalendarTokenRow> {
  const result = await q.query<CalendarTokenRow>(
    `INSERT INTO calendar_tokens (user_id, provider, scope, encrypted_access_token, encrypted_refresh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider) DO UPDATE
       SET scope = EXCLUDED.scope,
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, calendar_tokens.encrypted_refresh_token),
           expires_at = EXCLUDED.expires_at,
           updated_at = now()
     RETURNING *`,
    [
      input.userId,
      input.provider,
      input.scope,
      input.encryptedAccessToken,
      input.encryptedRefreshToken,
      input.expiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("saveCalendarToken: no row returned");
  return row;
}

export async function getUserById(q: Queryable, userId: string): Promise<UserRow | null> {
  const result = await q.query<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Phase 2: queries for propose_times wiring
// ---------------------------------------------------------------------------

export interface SessionMemberWithUser {
  /** Opaque internal user UUID. */
  readonly userId: string;
  /** Platform-side ID for sending DMs back to the user. */
  readonly platformUserId: string;
  /** Display name as the platform reports it. */
  readonly displayName: string;
  readonly rail: RailId;
  /** Status in this session: pending / connected / declined. */
  readonly status: SessionMemberStatus;
  /** True if this user has at least one calendar provider with a stored token. */
  readonly hasCalendar: boolean;
  /** Which provider(s) the user is connected to. Empty if hasCalendar is false. */
  readonly providers: ReadonlyArray<CalendarProvider>;
}

/**
 * List every member of a session along with their calendar-connection state.
 * Used by propose_times to decide which members to query free/busy for.
 *
 * The join collapses calendar_tokens via array_agg so users with multiple
 * providers (e.g. Google + Microsoft) come back as one row.
 */
export async function listSessionMembers(
  q: Queryable,
  sessionId: string,
): Promise<ReadonlyArray<SessionMemberWithUser>> {
  // Note: sm.joined_at MUST be in GROUP BY (or wrapped in an aggregate)
  // because ORDER BY references it. Without it, Postgres rightly refuses
  // to guess which joined_at to sort by. Each (session_id, user_id) is
  // unique in session_members, so adding joined_at to GROUP BY doesn't
  // change the grouping cardinality.
  const result = await q.query<{
    user_id: string;
    platform_user_id: string;
    display_name: string;
    rail: RailId;
    status: SessionMemberStatus;
    providers: ReadonlyArray<CalendarProvider> | null;
  }>(
    `SELECT
       u.id              AS user_id,
       u.platform_user_id,
       u.display_name,
       u.rail,
       sm.status         AS status,
       COALESCE(
         ARRAY_AGG(ct.provider) FILTER (WHERE ct.provider IS NOT NULL),
         '{}'
       ) AS providers
     FROM session_members sm
     JOIN users u                  ON u.id = sm.user_id
     LEFT JOIN calendar_tokens ct  ON ct.user_id = u.id
     WHERE sm.session_id = $1
     GROUP BY u.id, u.platform_user_id, u.display_name, u.rail, sm.status, sm.joined_at
     ORDER BY sm.joined_at ASC`,
    [sessionId],
  );

  return result.rows.map((r) => {
    const providers = r.providers ?? [];
    return {
      userId: r.user_id,
      platformUserId: r.platform_user_id,
      displayName: r.display_name,
      rail: r.rail,
      status: r.status,
      hasCalendar: providers.length > 0,
      providers,
    };
  });
}

/**
 * Fetch a user's calendar token for a specific provider, taking a row-level
 * lock so concurrent refreshes don't clobber each other. The caller MUST be
 * inside a transaction (use a PoolClient, not a Pool) — otherwise the lock
 * is released immediately and the protection is moot.
 *
 * Use `SKIP LOCKED` so a second concurrent caller fails fast (returns null)
 * rather than waiting on the first; the second caller can either retry or
 * skip this user for the current run.
 */
export async function getCalendarTokenForUser(
  client: import("pg").PoolClient,
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarTokenRow | null> {
  const result = await client.query<CalendarTokenRow>(
    `SELECT *
       FROM calendar_tokens
       WHERE user_id = $1 AND provider = $2
       FOR UPDATE SKIP LOCKED`,
    [userId, provider],
  );
  return result.rows[0] ?? null;
}

/** Non-locking read, suitable for serialisable inspection or out-of-band checks. */
export async function peekCalendarTokenForUser(
  q: Queryable,
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarTokenRow | null> {
  const result = await q.query<CalendarTokenRow>(
    "SELECT * FROM calendar_tokens WHERE user_id = $1 AND provider = $2",
    [userId, provider],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// free_busy_cache helpers
// ---------------------------------------------------------------------------

const DEFAULT_FREE_BUSY_TTL_SECONDS = 60 * 60; // 1 hour

export interface CachedFreeBusy {
  readonly busyPeriods: ReadonlyArray<{ readonly start: string; readonly end: string }>;
  readonly fetchedAt: Date;
}

/**
 * Read a cached free/busy lookup. Returns null when no row, or when the row
 * is older than the TTL (default 1 hour). TTL is enforced in code, not via
 * DB-side cleanup, so stale rows survive but are never returned.
 */
export async function readFreeBusyCache(
  q: Queryable,
  userId: string,
  windowStart: Date,
  windowEnd: Date,
  options: { readonly ttlSeconds?: number } = {},
): Promise<CachedFreeBusy | null> {
  const result = await q.query<{
    busy_periods: ReadonlyArray<{ start: string; end: string }>;
    fetched_at: Date;
  }>(
    `SELECT busy_periods, fetched_at
       FROM free_busy_cache
       WHERE user_id = $1
         AND window_start = $2
         AND window_end = $3`,
    [userId, windowStart, windowEnd],
  );
  const row = result.rows[0];
  if (!row) return null;

  const ttl = options.ttlSeconds ?? DEFAULT_FREE_BUSY_TTL_SECONDS;
  const ageSeconds = (Date.now() - row.fetched_at.getTime()) / 1000;
  if (ageSeconds > ttl) return null;

  return { busyPeriods: row.busy_periods, fetchedAt: row.fetched_at };
}

export interface WriteFreeBusyCacheInput {
  readonly userId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly busyPeriods: ReadonlyArray<{ readonly start: string; readonly end: string }>;
}

/**
 * Write or refresh a free/busy cache entry. Upserts on
 * (user_id, window_start, window_end).
 */
export async function writeFreeBusyCache(
  q: Queryable,
  input: WriteFreeBusyCacheInput,
): Promise<void> {
  await q.query(
    `INSERT INTO free_busy_cache (user_id, window_start, window_end, busy_periods, fetched_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (user_id, window_start, window_end) DO UPDATE
       SET busy_periods = EXCLUDED.busy_periods,
           fetched_at = now()`,
    [
      input.userId,
      input.windowStart,
      input.windowEnd,
      JSON.stringify(input.busyPeriods),
    ],
  );
}

// Re-export some commonly-used types for callers that import only this module.
export type { SessionMemberStatus };
