# Security policy

How Odon thinks about security, what it promises, where it cannot yet promise anything, and how to tell us about something we missed.

## What Odon promises (the hard rules)

These rules are enforced in code. They live in [`CLAUDE.md`](./CLAUDE.md) and the threat table below, and they don't move.

1. **Free/busy only.** The bot reads availability windows. It never reads event titles, attendees, or locations from anyone's calendar.
2. **No write tokens by default.** The default OAuth scope is `calendar.freebusy`. When the bot proposes a hangout, members add it to their own calendars via a personalized deeplink. The bot does not hold write access.
3. **Calendar write access is per-user opt-in.** A member who explicitly runs `/autoadd on` triggers a re-OAuth that grants `calendar.events`. The upgrade is logged. The member can run `/autoadd off` to revoke. This is the only code path that ever touches the broader scope.
4. **The LLM never sees PII.** Names, phone numbers, calendar event titles, and raw OAuth tokens never enter a Gemini prompt. The LLM works against opaque IDs and time slots only. Names get resolved post-LLM by the adapter.
5. **Function-calling mode only.** Every Gemini call is structured tool-calling with typed schemas. There is no free-form chat endpoint anywhere in the engine. This is also what keeps Odon inside Meta's January 2026 WhatsApp Cloud API "concrete business task" allowed list.
6. **Webhook signature verification.** Every adapter verifies HMAC signatures at the edge. Unverified requests get dropped with 401 before any work happens.
7. **No unsolicited DMs with links.** The bot never sends a DM containing a link unless the user initiated a flow that requires that link (e.g. they typed `/autoadd on` and the OAuth link is the response). This is documented so users know to ignore any "click here to verify" DMs they see; those are not us.
8. **Append-only audit log.** Every state change writes a row with caller, action, session, and timestamp. Once written, entries are not modified.

## Threat model

| Threat | Mitigation in code |
|---|---|
| Prompt injection via group messages | LLM in function-calling mode only. User text never concatenated into the system prompt. Args validated by Zod before any function executes. ([`src/llm/dispatcher.ts`](./src/llm/dispatcher.ts)) |
| LLM proposes an unauthorized function | Dispatcher runs a per-function `authorize()` against caller+session context before executing. The LLM cannot self-authorize. |
| LLM smuggles fields out via the result | Handlers re-validate output against an LLM-safe Zod schema. Extra fields are stripped (defence in depth). |
| Confused LLM loops infinitely | Per-session call budget caps the chain length. Returns `BUDGET_EXHAUSTED` to the caller. |
| Stolen OAuth token | Tokens stored encrypted (envelope encryption, KMS-wrapped key). Default scope is `calendar.freebusy`, which limits blast radius. |
| Spoofed webhook | HMAC signature verification on every adapter webhook. |
| Phishing using the bot's identity | Hard rule #7. Documented publicly so users know what to ignore. |
| Rate-limit abuse | Per-session token-bucket budget on LLM calls. HTTP-layer rate limiting added at deploy (see below). |
| PII leak via logs | `LOG_LEVEL` env var is validated against a whitelist. No tokens or PII are ever logged. |
| Supply chain | `npm audit` in CI gates merges. Dependabot enabled. Versions pinned. Lockfile committed. No unofficial libraries (Baileys is deliberately optional and self-host-only, with risk documented). |
| Excessive HTTP body | Explicit Fastify `bodyLimit` (256 KB). |
| CORS abuse | CORS is not enabled. Endpoints are server-to-server (webhooks) only. A future browser client triggers an explicit, origin-locked CORS config; no wildcard. |

## Known operational concerns (not bugs today, real risks at deployment)

These don't violate any hard rule, but they need to be addressed before the engine is exposed publicly.

- **Call budget is in-memory.** `InMemoryCallBudget` is per-process. A horizontally-scaled deploy would let a determined caller multiply their budget across replicas. Production wires this to Redis. The interface (`CallBudget`) stays the same, so the swap is a single class change.
- **Audit sink is stderr.** `ConsoleAuditSink` writes JSON lines to stderr. Useful for local dev. Production wires this to the `audit_log` Postgres table, with the same interface.
- **No HTTP-layer rate limiting yet.** Once we're exposed beyond localhost, the Fastify server needs IP-keyed rate limits via `@fastify/rate-limit`.
- **No CI security scanning yet.** When we push to GitHub, add: `npm audit --audit-level=high` on every PR, `gitleaks` or `trufflehog` for secret scanning, Dependabot for upgrades.

## Reporting a vulnerability

If you find something, please **do not open a public issue**.

Email: send a write-up to the maintainer (currently: open an empty issue titled "private contact needed" or DM `Skappy-Yolo` on GitHub; a dedicated `security@odon.gg` mailbox will be set up at first launch).

What helps in a report:
- A description of the vulnerability and a minimum-impact proof of concept (do not exploit further).
- Affected commit hash or version.
- Suggested mitigation if you have one.

We aim to respond within 48 hours and to ship a fix or workaround within 7 days for high-severity issues. As an AGPL project run by volunteers, we cannot offer paid bug bounties. We will credit reporters in release notes unless asked not to.

## Scope

This policy covers `odon-core` and the official per-rail adapters maintained alongside it (`odon-telegram`, `odon-whatsapp-cloud`, future `odon-discord`). The optional `odon-whatsapp-baileys` self-host adapter has its own caveats: it relies on a reverse-engineered WhatsApp Web library and carries account-ban risk on the operator's WhatsApp number. The Baileys adapter is offered for personal self-hosting only and is not run as a hosted service by the maintainers.

Out of scope: third-party hostings of Odon, derivative works, and any use of the OSS code outside the maintained adapters.
