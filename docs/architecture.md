# Architecture

How Odon is put together, and why. This is the canonical reference. If a decision in code looks weird, the reasoning is here.

## The product in one paragraph

Odon coordinates friend-group hangouts in the chat platforms people already use. A user mentions the bot in their group, the bot helps everyone find a time they're free and a place that works, then each member adds the event to their own calendar. The bot reads availability (free/busy only, never event titles) and proposes; it never writes to anyone's calendar without explicit opt-in. The same engine ships to Telegram first, then OpenClaw, WhatsApp Cloud API, Discord, and a web demo.

## The strategic bet

The bet is that the engine is the product and the rails are commodities. Most calendar-coordination tools build a website. We build an engine plus thin adapters, because the place to coordinate a friend hangout is in the group chat, not on a webpage.

This shapes everything: the adapter contract is small and platform-agnostic, the orchestrator is rail-aware but rail-agnostic, the LLM is sandboxed to function-calling only so the same prompts work in any rail.

## System architecture

```
                  ┌─────────────── INBOUND (rails / adapters) ────────────────┐                                                                              ┌──── OUTBOUND ────┐
                  │                                                            │                                                                              │                  │
   ┌──────────┐   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │   ┌──────────────── odon-core (the engine) ─────────────────────────────┐   │  ┌────────────┐  │
   │  User in │   │  │ Telegram │  │ WhatsApp │  │ WhatsApp │  │ OpenClaw │   │   │                                                                     │   │  │  Google    │  │
   │  a chat  │──▶│  │  Bot +   │  │  Cloud   │  │ Baileys  │  │  skill   │──▶│──▶│  Adapter contract  ──▶  Intent router  ──▶  Gemini  ──▶  Function   │──▶│──│  Calendar  │  │
   │  app /   │   │  │ Mini App │  │   API    │  │ self-host│  │  (multi- │   │   │  (IncomingMessage,     (commands +        function-      dispatcher  │   │  │ free/busy  │  │
   │  agent   │   │  │   ⭐P1   │  │   P3     │  │  optional│  │ channel) │   │   │   GroupContext,         LLM fallback)     calling ONLY,  + permission│   │  └────────────┘  │
   └──────────┘   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │   │   User, Session)                          no chat mode)  enforcement  │   │  ┌────────────┐  │
                  │                                                            │   │                                                          │           │   │  │  Microsoft │  │
                  │  ┌──────────┐  ┌──────────┐                                │   │                                                          ▼           │──▶│──│   Graph    │  │
                  │  │ Discord  │  │ odon-web │                                │   │                       ┌──────────────────── PURE LOGIC ─────────┐    │   │  │ free/busy  │  │
                  │  │   bot    │  │  (demo)  │                                │   │                       │  Overlap    Ranking    Venue scoring  │    │   │  └────────────┘  │
                  │  │   P4     │  │   P5     │                                │   │                       │  detector   (weekend>  (Google Places │    │   │  ┌────────────┐  │
                  │  └──────────┘  └──────────┘                                │   │                       │             weekday)   distance, ★)   │    │──▶│──│  iCloud    │  │
                  └────────────────────────────────────────────────────────────┘   │                       └──────────────────────────────────────┘    │   │  │  CalDAV    │  │
                                                                                   │                                                          │           │   │  │ free/busy  │  │
                                                                                   │                                                          ▼           │   │  └────────────┘  │
                                                                                   │                       ┌─────────────────── ORCHESTRATOR ────────┐    │   │  ┌────────────┐  │
                                                                                   │                       │ • Session lifecycle (id → members)     │    │──▶│──│  Google    │  │
                                                                                   │                       │ • Quorum tracker (connected vs total)  │    │   │  │  Places    │  │
                                                                                   │                       │ • Deadline timer + hourly status posts │    │   │  │   API      │  │
                                                                                   │                       │ • "wait / proceed" decision handler    │    │   │  │ (venues)   │  │
                                                                                   │                       │ • Voting tally across rails            │    │   │  └────────────┘  │
                                                                                   │                       └────────────────────────────────────────┘    │   │                  │
                                                                                   │                                                          │           │   └──────────────────┘
                                                                                   │                                                          ▼           │
                                                                                   │   ┌──────────────────── DATA LAYER (Postgres + Redis) ──────────┐   │
                                                                                   │   │  groups · sessions · members · free_busy_cache · hangouts ·  │   │
                                                                                   │   │  encrypted_oauth_tokens · audit_log · venue_cache             │   │
                                                                                   │   │  Redis: rate limit buckets · cron locks · session TTL         │   │
                                                                                   │   └───────────────────────────────────────────────────────────────┘   │
                                                                                   └─────────────────────────────────────────────────────────────────────┘
```

## The adapter contract

Every rail implements one TypeScript interface. The full type is in [`../src/core/contract.ts`](../src/core/contract.ts), but the shape is:

```typescript
interface Adapter {
  rail: RailId
  send(message: OutgoingMessage): Promise<void>
  verifyWebhookSignature(headers, body): boolean
  normalize(rawWebhook): IncomingMessage
}
```

That's it. An adapter knows two things: how to talk to its platform, and how to translate its platform's events into our `IncomingMessage` shape. Everything else is the engine's job.

The contract is deliberately tiny. Add fields and you tie the engine to one platform's mental model. The bigger the contract, the harder the next adapter.

## Phase ordering and why

1. **Telegram** ships first because it's the only major rail where the bot can actually live inside a group chat in 2026 (Discord can too, but the audience is different). Native bot API, no policy friction, mini app support, half a billion users on group chats.
2. **OpenClaw skill** ships second because OpenClaw has 371k stars and a marketplace, and we inherit multi-channel for free. It's a different UX shape (personal AI acting on the user's behalf, not a third-party group bot), but the engine doesn't care.
3. **WhatsApp Cloud API** ships third. Biggest TAM globally, hardest UX (bot can't be in groups, must use the session-ID workaround), tightest policy (Meta's January 2026 ban on general-purpose LLM bots; we're inside the "Appointments & Reservations" allowed category).
4. **Discord** ships fourth, mostly as an OSS visibility win and a sanity check that the contract is truly platform-agnostic.
5. **Web demo** is last and intentional. It's how people landing from X threads play with Odon without installing anything. Not the primary product.

## User flows by rail

### Telegram flow (the in-group native experience)

```
  GROUP CHAT (Telegram)                              ODON-CORE                          1:1 DM (Telegram)                 GOOGLE
═════════════════════════                       ════════════════════               ═══════════════════════           ═══════════════

 ┌──────────────────────┐
 │ Sarah: @odon find    │
 │ time for movie       │──┐
 │ this weekend         │  │
 └──────────────────────┘  │
                           │  webhook + signature
                           ▼
                       ┌───────────────────────┐
                       │ adapter normalizes →  │
                       │ create session s_abc  │
                       │ read group roster     │
                       └──────────┬────────────┘
                                  │
 ┌──────────────────────┐         │
 │ Bot: 5 in group.     │◀────────┘
 │ ✅ Sarah, Mike (2)   │
 │ ❓ Tunde,Aisha,Bola  │
 │ [Wait][Proceed][⏰]  │
 └─────────┬────────────┘
           │ Sarah taps [Wait 24h]
           ▼
                                                                                  ┌──────────────────────┐
                                  ┌────────────────────┐                          │ Bot DMs Tunde:       │
                                  │ orchestrator       │─────────────────────────▶│ "Connect calendar:   │─┐
                                  │ schedules hourly   │                          │  [tap to OAuth]"     │ │
                                  │ status + DM fanout │─────────────────────────▶│ Same for Aisha,Bola  │ │
                                  └─────────┬──────────┘                          └──────────────────────┘ │ user taps
                                            │                                                              ▼
                                            │                                                          ┌─────────┐
                                            │                                                          │ Google  │
                                            │                                                          │ OAuth   │
                                            │                                                          │ consent │
                                            │                                                          │  scope: │
                                            │                                                          │ freebusy│
                                            │                                                          └────┬────┘
                                            │                                                               │
                                            │                  encrypted token stored                       │
                                            │◀──────────────────────────────────────────────────────────────┘
                                            │
 ┌──────────────────────┐                   │
 │ Bot: hourly status   │◀──── every hour ──┘
 │ 4/5 connected.       │
 │ Waiting on Bola.     │
 │ [Proceed now]        │
 └─────────┬────────────┘
           │ deadline OR [Proceed] tapped
           ▼
                                  ┌────────────────────┐         calendar.freebusy reads
                                  │ overlap detector + │─────────────────────────────────────────────────────────────────────────▶
                                  │ ranking            │◀────────────────────────────── busy slots ─────────────────────────────────
                                  └─────────┬──────────┘
                                            │
 ┌──────────────────────┐                   │
 │ Bot: Top 3:          │◀──────────────────┘
 │ 1. Sat 7pm — all 4   │
 │ 2. Sun 3pm — 3/4     │
 │ 3. Sat 4pm — 3/4     │
 │ [1][2][3] [where]    │
 └─────────┬────────────┘
           │ user taps [where]
           ▼
                                  ┌────────────────────┐    Google Places (cinemas near Lekki)
                                  │ venue scorer       │───────────────────────────────────────────────────────────────────────▶
                                  └─────────┬──────────┘
                                            │
 ┌──────────────────────┐                   │
 │ Bot: Venue options:  │◀──────────────────┘
 │ 1. Filmhouse Lekki   │
 │ 2. Genesis Maryland  │
 │ [Pick 1][Pick 2]     │
 └─────────┬────────────┘
           │ user taps [Pick 1]
           ▼
 ┌──────────────────────┐
 │ Bot: Locked: Sat 7pm │
 │ at Filmhouse Lekki.  │
 │ Tap to add to your   │
 │ own calendar:        │
 │ Sarah:[📅] Mike:[📅] │
 └──────────────────────┘
       per-user calendar deeplinks (no write tokens — user writes to their own calendar)
```

### WhatsApp Cloud API flow (session-ID workaround, because bots can't be in groups)

```
   Sarah's 1:1 DM with bot          GROUP CHAT (WhatsApp)        Each member's 1:1 DM            ODON-CORE             GOOGLE
   ════════════════════════         ═════════════════════        ══════════════════════         ═══════════         ═════════

   ┌──────────────────────┐
   │ Sarah: /new movie    │
   │ weekend, deadline 24h│──────────────────────────────────────────────────────────────────▶ create session
   └──────────────────────┘                                                                    s_abc123

   ┌──────────────────────┐
   │ Bot: session created.│
   │ paste group invite   │
   │ link so I know which │
   │ group this is for.   │
   └──────────┬───────────┘
              │
   ┌──────────▼───────────┐
   │ Sarah: chat.whatsapp │
   │ .com/JKx9p2qR8nABcDeF│──────────────────────────────────────────────────────────────────▶ fetch og:title
   └──────────────────────┘                                                                    "The Squad"

   ┌──────────────────────┐
   │ Bot: got it,         │
   │ The Squad. What's    │
   │ this hangout for?    │
   │ Set a password.      │
   └──────────┬───────────┘
              │
   ┌──────────▼───────────┐
   │ Sarah: "movie weekend│
   │  password: the lekki │
   │  gang"               │
   └──────────────────────┘

   ┌──────────────────────┐
   │ Bot: share this msg  │
   │ in The Squad:        │
   │ wa.me/<b>?text=join_ │
   │ s_abc123             │
   │ Password when asked: │
   │ the lekki gang       │
   └─────────┬────────────┘
             │ Sarah copies, pastes in group
             ▼
                                ┌────────────────────────┐
                                │ Sarah (in group):      │
                                │ "Let's use Odon"       │
                                │ wa.me/<b>?text=join_   │
                                │ s_abc123               │
                                └─────────┬──────────────┘
                                          │ Mike, Tunde tap
                                          ▼
                                                            ┌────────────────────────┐
                                                            │ Mike (now in 1:1 DM    │
                                                            │ with bot):             │
                                                            │ join_s_abc123          │────────▶ session.add(Mike, pending)
                                                            └────────────────────────┘

                                                            ┌────────────────────────┐
                                                            │ Bot DMs Mike:          │
                                                            │ "joining The Squad's   │◀──────── verify password challenge
                                                            │  movie weekend.        │
                                                            │  password please:"     │
                                                            └─────────┬──────────────┘
                                                                      │
                                                            ┌─────────▼──────────────┐
                                                            │ Mike: the lekki gang   │────────▶ verify, then OAuth invite
                                                            └────────────────────────┘
                                                                                                                ┌───────────┐
                                                                                                                │  Google   │
                                                                                                                │  OAuth    │
                                                                                                                │  freebusy │
                                                                                                                └─────┬─────┘
                                                                                              token (encrypted) ◀─────┘
   ┌──────────────────────┐
   │ Bot (hourly to Sarah)│
   │ 3/4 connected.       │◀──────────────────────────────────────────────────────────────── status update job
   │ Share-to-group link: │
   │ wa.me/<b>?text=      │
   │ status_s_abc123      │
   └──────────────────────┘

                                                            ┌────────────────────────┐
                                                            │ At deadline, bot DMs   │
                                                            │ ALL session members:   │◀──────── compute overlap
                                                            │ "Top 3 times: ...      │
                                                            │  Reply 1, 2, or 3"     │
                                                            └─────────┬──────────────┘
                                                                      │ each member votes
                                                                      │ in their own DM
                                                                      ▼
                                                                                          tally by session_id

                                                            ┌────────────────────────┐
                                                            │ Bot DMs every member:  │
                                                            │ "final: Sat 7pm,       │◀──────── result + cal deeplinks
                                                            │  Filmhouse Lekki.      │
                                                            │  Add to cal: [📅]"     │
                                                            └────────────────────────┘
```

### OpenClaw skill flow (personal AI acting on the user's behalf)

```
                    ┌──── ALICE'S MACHINE ────┐
                    │                         │
   ┌──────────────┐ │   ┌─────────────────┐   │   ┌──── ALICE's RAILS ────────────────────────┐
   │ Alice talks  │ │   │ OpenClaw runs   │   │   │                                            │
   │ to her       │─┼──▶│ locally, loads  │──▶│──▶│  Telegram │ WhatsApp │ Discord │ iMessage │
   │ OpenClaw     │ │   │ "odon" skill    │   │   │  (Alice's accounts, OpenClaw acts AS her)  │
   │ "find a time │ │   │                 │   │   └────────────────────────────────────────────┘
   │  with Bob &  │ │   └────────┬────────┘   │
   │  Carol"      │ │            │            │             ↑
   └──────────────┘ │            ▼            │             │ Bob & Carol receive normal messages from Alice
                    │   ┌─────────────────┐   │             │ via whatever channel they're on. No bot. They
                    │   │ skill calls     │   │             │ just see Alice asking.
                    │   │ odon-core HTTP  │   │
                    │   │ API for overlap │   │
                    │   └─────────────────┘   │
                    └─────────────────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  odon-core   │
                       │  (hosted     │
                       │   free tier) │
                       └──────────────┘
```

### Baileys self-host flow (in-group like Telegram, but user runs their own node)

```
                         ┌──── USER'S MACHINE (self-host) ────┐
                         │                                    │
   ┌──────────────────┐  │  ┌────────────────────────────┐   │   ┌───────────────┐   ┌─────────┐
   │ WhatsApp group   │  │  │ odon-whatsapp-baileys      │   │   │ odon-core     │   │ Google  │
   │ chat (real)      │◀─┼──│ (linked device, scans QR   │◀──┼──▶│ (same engine, │◀─▶│ free/   │
   │                  │──┼─▶│  on user's own number)     │──▶│   │  same DB)     │   │ busy    │
   └──────────────────┘  │  └────────────────────────────┘   │   └───────────────┘   └─────────┘
                         │           ▲                       │
                         │           │  ToS gray zone        │
                         │           │  user accepts risk    │
                         │           │  for their own number │
                         └───────────┼───────────────────────┘
                                     │
                            ⚠️  Document loudly in README:
                            ⚠️  • Use a number you can afford to lose
                            ⚠️  • Not for hosted multi-tenant deployment
                            ⚠️  • Self-host only, single WhatsApp account
```

## OAuth and the privacy boundary

The single most important security property: **the LLM never sees user names, calendar event titles, or raw tokens**. It only sees opaque IDs, time slots, and a whitelisted vocabulary of tool calls. Names and venue details are stitched back in post-LLM by the adapter.

```
   USER                ADAPTER              ORCHESTRATOR             LLM (Gemini)        FUNCTION DISPATCHER       DATA LAYER         GOOGLE
   ════                ═══════              ════════════             ════════════        ═══════════════════       ══════════         ══════

   tap [Connect]──▶   construct OAuth URL ───────────────────────────────────────────────────────────────────────────────────────────▶ consent
                     ◀───── code ──────────────────────────────────────────────────────────────────────────────────────────────────── redirect
                          exchange ────────────────────────────────────────────────────────────────────────────────────────────────▶ token
                     ◀────────────────────────────────────────────────────────────────────────────────────────────────────────────── token

                          encrypt ────────────────▶ token_vault.encrypt() ──────────────────────────────────────────────▶ store (KMS-wrapped key)


   "find time"──▶    normalize ────▶    build LLM context:
                                        - user_ids (opaque, NOT names)
                                        - session_id
                                        - time_window
                                        - allowed_tools
                                        ────────────────────────▶  Gemini (function calling mode ONLY)
                                                                   proposes: get_availability(uids, window)
                                                                ───────────────────────▶  permission check (caller in session?)
                                                                                          ────▶ load encrypted tokens
                                                                                                ────▶ decrypt in-memory
                                                                                                ────▶ call calendar.freebusy ──────────────▶ API
                                                                                                ◀────── busy slots ───────────────────────── API
                                                                                                ────▶ run overlap detector
                                                                ◀──────────────────── filtered tool output:
                                                                                       only fields whitelisted for LLM
                                                                                       (slot times + count, NO names)
                                                                   proposes: propose_times(top_3)
                                        ◀──────────────────────
                          render with names resolved POST-LLM in adapter
   ◀──── reply ───
```

## Data model (sketch)

The schema lives in `src/db/schema.sql` (forthcoming) and roughly contains:

- `groups` — one row per platform group the bot has seen. `(rail, platform_group_id)` unique.
- `users` — one row per platform user. `(rail, platform_user_id)` unique. Encrypted OAuth tokens stored here.
- `sessions` — one row per hangout request. Belongs to a group, has an initiator, a deadline, a status, an optional hashed password.
- `session_members` — joining table. `(session_id, user_id)` with `joined_at`, `password_verified`, `connected_at`.
- `free_busy_cache` — short-lived cache of free/busy reads, keyed by `(user_id, window_start, window_end)`. TTL 1 hour to avoid hammering provider APIs.
- `hangouts` — confirmed hangouts. Time, venue (optional), participating user IDs.
- `venue_cache` — Google Places results, cached aggressively.
- `audit_log` — append-only. Every state change, every external call, every permission decision.

Phase 1 stores everything except `venue_cache` (deferred until venue suggestions land).

## What's NOT in this architecture (deliberately)

- A user-facing web app. The bot is the surface. There's a one-page `odon.gg` to bootstrap new users (a "Start with Odon on Telegram" button) and that's it.
- Multi-tenant SaaS plumbing. We're not selling per-seat licences. Sessions are per-group, free.
- Calendar write access. Default. The opt-in `/autoadd on` flow upgrades a single user's OAuth scope to `calendar.events` and that path is the only place in the code that ever touches the write scope.
- AI chat. The LLM is constrained to function-calling mode. There is no free-form conversational endpoint anywhere in the engine.
- Group member enumeration on WhatsApp. The Cloud API does not expose group rosters and we never use Baileys for hosted deployment. We work around the gap with the session-ID + password design.
