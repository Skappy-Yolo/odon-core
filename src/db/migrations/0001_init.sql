-- 0001_init.sql
-- Initial schema for odon-core. Rail-agnostic: every user and group is
-- discriminated by `(rail, platform_*_id)` so the same engine serves
-- Telegram, WhatsApp Cloud, OpenClaw, Discord, and a web demo from the
-- same tables.

-- All times are UTC. All timestamps are TIMESTAMPTZ.

-- This file is intended to be applied by tools/db/migrate.ts on a fresh
-- database. It is idempotent at the table level (CREATE TABLE IF NOT
-- EXISTS), but indexes and constraints are not — re-running on an
-- existing database is undefined. Real migrations live in this folder.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- A user as seen by the bot, identified by their platform ID on a specific
-- rail. Display name is provided by the platform; we never store other PII.

CREATE TABLE IF NOT EXISTS users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    rail                TEXT            NOT NULL,
    platform_user_id    TEXT            NOT NULL,
    display_name        TEXT            NOT NULL,
    timezone            TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (rail, platform_user_id)
);

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
-- A platform-side group the bot has seen.

CREATE TABLE IF NOT EXISTS groups (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    rail                TEXT            NOT NULL,
    platform_group_id   TEXT            NOT NULL,
    display_name        TEXT            NOT NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (rail, platform_group_id)
);

-- ---------------------------------------------------------------------------
-- calendar_tokens
-- ---------------------------------------------------------------------------
-- One row per (user, provider). Tokens are encrypted with envelope
-- encryption before being stored: encrypted_access_token = AES-GCM(
--   plaintext_token, data_key); data_key is itself wrapped by a KMS key.
-- The DB never sees plaintext.
--
-- Default scope is "freebusy". The wider "events" scope is only granted
-- through the explicit /autoadd opt-in flow.

CREATE TABLE IF NOT EXISTS calendar_tokens (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider                    TEXT            NOT NULL CHECK (provider IN ('google', 'microsoft', 'icloud')),
    scope                       TEXT            NOT NULL CHECK (scope IN ('freebusy', 'events')) DEFAULT 'freebusy',
    encrypted_access_token      BYTEA           NOT NULL,
    encrypted_refresh_token     BYTEA,
    expires_at                  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
-- A single hangout coordination request. Belongs to a group, started by a
-- user, with a deadline. Optional password gate (for WhatsApp Cloud where
-- the bot can't be in the group; the password keeps strangers with the
-- invite link out).
--
-- short_code is the user-facing slug embedded in the invite URL
-- (wa.me/<bot>?text=join_<short_code>, t.me/<bot>?start=<short_code>).

CREATE TABLE IF NOT EXISTS sessions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    short_code          TEXT            NOT NULL UNIQUE,
    group_id            UUID            NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    initiator_user_id   UUID            NOT NULL REFERENCES users(id),
    label               TEXT            NOT NULL,
    deadline            TIMESTAMPTZ     NOT NULL,
    password_hash       TEXT,
    status              TEXT            NOT NULL CHECK (status IN ('open', 'computing', 'voting', 'closed', 'cancelled')) DEFAULT 'open',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_group_status ON sessions(group_id, status);

-- ---------------------------------------------------------------------------
-- session_members
-- ---------------------------------------------------------------------------
-- Joining table. A member's status moves: pending -> connected | declined.
-- password_verified is true once the member proved group membership (only
-- relevant for password-gated sessions on WhatsApp Cloud).

CREATE TABLE IF NOT EXISTS session_members (
    session_id              UUID            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id                 UUID            NOT NULL REFERENCES users(id),
    joined_at               TIMESTAMPTZ     NOT NULL DEFAULT now(),
    password_verified       BOOLEAN         NOT NULL DEFAULT FALSE,
    calendar_connected_at   TIMESTAMPTZ,
    status                  TEXT            NOT NULL CHECK (status IN ('pending', 'connected', 'declined')) DEFAULT 'pending',
    PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members(user_id);

-- ---------------------------------------------------------------------------
-- free_busy_cache
-- ---------------------------------------------------------------------------
-- Short-lived cache of free/busy reads. Keyed by (user, window). The cache
-- is to avoid hammering provider APIs during a single coordination session;
-- entries older than the TTL (default: 1 hour, enforced in code) are
-- ignored and re-fetched.

CREATE TABLE IF NOT EXISTS free_busy_cache (
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start    TIMESTAMPTZ     NOT NULL,
    window_end      TIMESTAMPTZ     NOT NULL,
    busy_periods    JSONB           NOT NULL,
    fetched_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, window_start, window_end)
);

-- ---------------------------------------------------------------------------
-- hangouts
-- ---------------------------------------------------------------------------
-- A confirmed hangout. One row per session that reaches the confirm step.

CREATE TABLE IF NOT EXISTS hangouts (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    starts_at               TIMESTAMPTZ     NOT NULL,
    ends_at                 TIMESTAMPTZ     NOT NULL,
    venue_name              TEXT,
    venue_place_id          TEXT,
    venue_address           TEXT,
    confirmed_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
    confirmed_by_user_id    UUID            NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_hangouts_session ON hangouts(session_id);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
-- Append-only. Every state change, every dispatcher outcome, every
-- external call worth tracing. Writes via a single Postgres role; that
-- role does NOT have UPDATE or DELETE on this table, enforced at the
-- role-permissions layer (out of scope for this migration).

CREATE TABLE IF NOT EXISTS audit_log (
    id                  BIGSERIAL       PRIMARY KEY,
    at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    caller_user_id      UUID,
    session_id          UUID,
    rail                TEXT,
    action              TEXT            NOT NULL,
    outcome             TEXT            NOT NULL,
    details             JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(session_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_caller ON audit_log(caller_user_id, at DESC);

-- ---------------------------------------------------------------------------
-- schema_migrations
-- ---------------------------------------------------------------------------
-- Tracks which migrations have been applied. Used by tools/db/migrate.ts.

CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT            PRIMARY KEY,
    applied_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMIT;
