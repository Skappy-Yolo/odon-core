/**
 * TypeScript types for the schema in migrations/0001_init.sql.
 *
 * One file, hand-written, kept in sync with the SQL. We don't use an ORM
 * here: SQL is the source of truth, and these types are the contract the
 * rest of the engine reads from. If you change a column, update both files.
 *
 * Convention: rows use snake_case (matching SQL columns) so we don't have
 * to translate at the query layer. Higher-level layers can map to camelCase.
 */

export type RailId =
  | "telegram"
  | "whatsapp-cloud"
  | "whatsapp-baileys"
  | "discord"
  | "openclaw"
  | "web";

export type SessionStatus = "open" | "computing" | "voting" | "closed" | "cancelled";
export type SessionMemberStatus = "pending" | "connected" | "declined";
export type CalendarProvider = "google" | "microsoft" | "icloud";
export type CalendarScope = "freebusy" | "events";

export interface UserRow {
  readonly id: string;
  readonly rail: RailId;
  readonly platform_user_id: string;
  readonly display_name: string;
  readonly timezone: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface GroupRow {
  readonly id: string;
  readonly rail: RailId;
  readonly platform_group_id: string;
  readonly display_name: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface CalendarTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly provider: CalendarProvider;
  readonly scope: CalendarScope;
  readonly encrypted_access_token: Buffer;
  readonly encrypted_refresh_token: Buffer | null;
  readonly expires_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface SessionRow {
  readonly id: string;
  readonly short_code: string;
  readonly group_id: string;
  readonly initiator_user_id: string;
  readonly label: string;
  readonly deadline: Date;
  readonly password_hash: string | null;
  readonly status: SessionStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface SessionMemberRow {
  readonly session_id: string;
  readonly user_id: string;
  readonly joined_at: Date;
  readonly password_verified: boolean;
  readonly calendar_connected_at: Date | null;
  readonly status: SessionMemberStatus;
}

export interface FreeBusyCacheRow {
  readonly user_id: string;
  readonly window_start: Date;
  readonly window_end: Date;
  /** Array of `{ start: ISO8601 string, end: ISO8601 string }`. */
  readonly busy_periods: ReadonlyArray<{ readonly start: string; readonly end: string }>;
  readonly fetched_at: Date;
}

export interface HangoutRow {
  readonly id: string;
  readonly session_id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly venue_name: string | null;
  readonly venue_place_id: string | null;
  readonly venue_address: string | null;
  readonly confirmed_at: Date;
  readonly confirmed_by_user_id: string;
}

export interface AuditLogRow {
  readonly id: number | string;
  readonly at: Date;
  readonly caller_user_id: string | null;
  readonly session_id: string | null;
  readonly rail: RailId | null;
  readonly action: string;
  readonly outcome: string;
  readonly details: unknown;
}
