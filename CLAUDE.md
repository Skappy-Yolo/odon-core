# Claude Code project memory for odon-core

You are working on `odon-core`, the platform-agnostic engine for a hangout coordination bot that lives in users' group chats. Skip the project overview if you already know it. The plan that defines this project is at `C:\Users\Emmanuel Okanlawon\.claude\plans\i-don-t-think-this-stateless-dahl.md`.

## What this is

A TypeScript / Node 22+ engine plus thin per-rail adapters (Telegram first, then OpenClaw, then WhatsApp Cloud API, then optionally Discord and a Baileys self-host adapter). The engine handles session orchestration, free/busy reads, overlap detection, Gemini-driven function calling, and venue suggestions. Adapters speak the engine's normalized contract.

License: AGPL-3.0-or-later. Tagline: "Group hangouts in your group chats."

## Where things live

- `src/adapters/` — one folder per rail (telegram/, whatsapp/, etc.). Each implements the adapter contract.
- `src/core/` — adapter contract types (IncomingMessage, GroupContext, User, Session).
- `src/llm/` — Gemini function-calling orchestrator. Function-calling mode only, never free-form chat.
- `src/logic/` — pure functions: overlap detection, ranking, venue scoring, permission checks. No I/O, no LLM.
- `src/providers/` — outbound integrations: Google Calendar (free/busy), Microsoft Graph, iCloud CalDAV, Google Places.
- `src/orchestrator/` — session lifecycle, quorum tracker, deadline timer, status posts.
- `src/db/` — Postgres schema and queries. Encrypted token vault.
- `tools/` — scripts. `snap.ps1` is the screenshot helper Claude can trigger during work.
- `docs/` — architecture diagrams, design decisions.
- `tests/` — unit and integration tests (vitest).

## Conventions

- TypeScript strict mode. `noUncheckedIndexedAccess` is on, so array access is `T | undefined`. Handle it.
- ESM modules (`"type": "module"`). Import paths must include `.js` extension even for `.ts` files.
- One concern per file. If a file passes 200 lines, consider splitting.
- No `any`. Use `unknown` and narrow.
- No comments that restate what the code does. Only document non-obvious WHY.

## Hard rules (security and privacy)

These exist because they are part of the public security promise. Don't relax them.

1. **The LLM never sees user names, calendar event titles, or raw OAuth tokens.** It only sees opaque user IDs, time slots, and a whitelisted vocabulary of tool calls.
2. **All Gemini calls are function-calling mode with typed schemas.** No free-form chat. This is also what keeps the bot Meta-policy-compliant for WhatsApp Cloud API.
3. **OAuth default scope is `calendar.freebusy`.** Never request `calendar.events` without an explicit per-user opt-in (the `/autoadd on` flow).
4. **All webhooks verify HMAC signatures at the edge.** Drop unverified.
5. **No tokens, secrets, or PII in logs.** Ever.
6. **The audit log is append-only.** Every state change writes a row with caller, action, target, timestamp.

## Safe commands (Claude can run without asking)

- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run dev` (local dev server)
- Reading files, running git status / git diff / git log
- `git add` of specific files (not `-A` or `.`)
- Running PowerShell scripts in `tools/`

## Commands that need explicit user approval

- `git commit` (only when the user has explicitly asked to commit)
- `git push` or anything touching the remote
- `gh repo create` and any other `gh` write operation
- Anything that calls a live LLM API with the user's key (costs real money)
- Anything that sends real Telegram / WhatsApp messages (visible to real users)
- Anything that touches a production database

## Never do without explicit ask

- Write to the production database
- Push to main
- Send real bot messages from a dev branch
- Skip `--no-verify` on git hooks
- Change the OAuth scope from `calendar.freebusy` to anything broader, except inside the explicit `/autoadd on` flow path

## Useful pointers

- Plan: `C:\Users\Emmanuel Okanlawon\.claude\plans\i-don-t-think-this-stateless-dahl.md`
- Architecture: `docs/architecture.md`
- Build log: `BUILD_LOG.md`
- Security policy: `SECURITY.md`
- Threat model: see SECURITY.md and the plan
