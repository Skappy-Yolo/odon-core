# Build log

A public devlog written as the work happens. Each entry is dated and signed. This is the source material for X threads, dev.to posts, and screencasts. If you are reading this from outside the project: scroll to the most recent entry, that is where we are.

---

## 2026-05-13 — Day 1, later: `/find_time` actually creates rows

`/find_time movie this weekend` in a Telegram group called "Journal" returned `Code: PB9JACaZ`, and the matching row is now in Supabase. Querying the `sessions` table from a second process shows label, deadline, and status exactly as the bot reported. The `groups` table has Journal, the `users` table has the initiator. The orchestrator works end to end.

Two real obstacles came up on the way that are worth writing down.

First, the engine in `tsx watch` mode did not actually pick up the source changes I made to wire the orchestrator. The PID stayed the same after I edited five files, which means hot reload silently skipped the new code. The webhook handler kept routing to the old sync stub. Killing the watch process and starting `npm run dev` fresh got the new code loaded. Lesson: tsx watch is convenient until it isn't, and "the PID hasn't changed" is the cheapest signal that the restart didn't happen.

Second, Supabase free-tier projects only expose their direct connection (`db.<project-id>.supabase.co`) over IPv6. The Pg client failed with `ENOTFOUND` because my network resolved the name only via AAAA records and couldn't reach the IPv6 address. The migration earlier had worked through that path, so I assumed the URL was fine. It wasn't, on a different network at a different hour. The fix was to switch the connection string to Supabase's transaction pooler, `aws-0-<region>.pooler.supabase.com:6543`, which serves IPv4. Finding the right region took a brute-force loop across nine regions because Supabase doesn't tell you which region your project is in without going into the dashboard. eu-west-1 won. Documenting this in `docs/operations.md` for the next time someone hits it.

The bot's reply today still says "Next step (coming): each member connects their calendar and the bot proposes times where most of you are free." That's true. The session row exists, the data is shaped right, the IDs are opaque, but there's nothing yet to fan out OAuth requests to other group members or call the dispatcher's `propose_times` against real free/busy data. Those are the next two commits.

— Emmanuel

---

## 2026-05-13 — Day 1: real bot, real reply

The bot replied to `/start` in Telegram for the first time today. It works.

Setup took about fifteen minutes end-to-end: BotFather (`/newbot`, `/setprivacy → Disable`), a free Supabase Postgres, `npm run migrate` against the new database, `cloudflared tunnel --url http://localhost:3000` instead of ngrok (no signup, no authtoken, the quick-tunnel URL pops out and that becomes `ODON_PUBLIC_URL`), `npm run telegram:set-webhook`, then send `/start` in Telegram and the bot answered. The whole chain works: Telegram cloud sends an Update to a `*.trycloudflare.com` URL, cloudflared forwards it to `http://localhost:3000/webhook/telegram`, the engine verifies the secret token in `X-Telegram-Bot-Api-Secret-Token`, normalizes the update, routes to the `/start` handler, and sends a reply back via Telegram's `sendMessage` API. End to end in about two seconds, mostly Telegram-side latency.

Two small papercuts to fix on the way:

The dev script had the wrong flag order: `tsx --env-file-if-exists=.env watch src/index.ts` interprets `watch` as a positional argument (a filename) rather than the subcommand. It needs to be `tsx watch --env-file-if-exists=.env src/index.ts`. Once I fixed that, the engine started clean. Worth committing.

Port 3000 was already busy with a node process from yesterday's testing that I hadn't stopped properly. Killed via PID. Lesson: when you start servers in background during dev, keep track of them or you'll fight your own ghost an hour later.

The bot's behaviour today is intentionally thin. `/start` and `/help` show the welcome message that lists the four commands and includes the privacy line ("I only read free/busy from calendars, never event titles"). `/find_time`, `/where`, `/confirm` all reply with a "scaffolded but not wired" stub. That's correct: today's milestone was the wire-up, not the product. The next code milestone, when whenever it lands, is wiring `/find_time` to actually create a session in Postgres, fan out OAuth requests to the unconnected group members, run the quorum / deadline orchestrator, and call the dispatcher's `propose_times` function we tested two days ago against the real overlap algorithm.

— Emmanuel

---

## 2026-05-12 — Day 0, latest: the bot is operational

Did the thing I said was next. The Telegram adapter is wired into Fastify, the command router exists, and there are two operational scripts plus an `operations.md` that walks through setup from scratch.

The `/webhook/telegram` route is the only stateful endpoint on the engine right now. It runs the adapter's `verifyWebhookSignature` first and drops with 401 if the secret token header doesn't match. If verification passes, it normalizes the update and routes via `parseCommand`. Errors during routing or sending get logged and then 200-acked, because Telegram retrying a failed handler doesn't make the bug go away; logs do. If the env vars aren't set, the route just isn't registered and the server still serves `/health` for local dev.

Command router only has three substantive paths: `/start` and `/help` return a welcome message that mentions the commands and includes the privacy line ("I only read free/busy from calendars, never event titles"), and `/find_time`, `/where`, `/confirm` all stub-reply with "scaffolded but not wired" so a user gets a response rather than silence. The next sitting wires those three to the session orchestrator + the dispatcher + the data layer.

Two bin scripts. `npm run telegram:set-webhook` registers the public URL with Telegram and stores the secret token. `npm run telegram:delete-webhook` clears it for resets and rotations. Both take env input and fail loudly if anything's missing.

`docs/operations.md` is for the first deploy. Specifically called out the gotcha about Telegram's bot privacy default, which is on, which means the bot silently sees nothing in groups until you go into `@BotFather → /setprivacy → Disable`. I hit this in proactive-friend-bot back in January and spent an embarrassing amount of time wondering why the bot was deaf. Documenting it now so the next person who hits it spends ten seconds instead of an hour.

Eleven commits. Sixty-one tests, all green. Zero npm audit findings. Three things only the human can do from here: provision Postgres + a Telegram bot token, deploy somewhere with a public HTTPS URL, and run `npm run telegram:set-webhook`. After that, `/start` in a real group should print the welcome. The orchestrator-wired flow for `/find_time` is the next code milestone.

— Emmanuel

---

## 2026-05-12 — Day 0, late: the data layer and the first real rail

Two more commits, both substantial. The engine now has a place to put things and a way to hear from users.

The data layer was the easier of the two. I lifted ideas from both predecessors without lifting code from either. `hangout-pwa` had a richer schema but depended on Supabase's `auth.users` table, which is fine if you're building a Supabase app and very much not fine if you're building a bot whose users are identified by Telegram or WhatsApp IDs. `proactive-friend-bot` had a simpler schema but had `whatsapp_id` columns everywhere, which would make the same data unusable when we added the Telegram adapter. The new schema is rail-agnostic in the way the rest of the engine is: every user and group carries `(rail, platform_user_id)` or `(rail, platform_group_id)`. The same `users` table holds a Telegram user, a WhatsApp user, and an OpenClaw user side by side; the rail discriminator decides which.

Eight tables in the initial migration: `users`, `groups`, `calendar_tokens` (with `provider` and `scope` columns so we can support Google + Microsoft + iCloud, with `scope` defaulting to `freebusy` and only the `/autoadd` flow upgrading), `sessions` (with the `short_code` slug that goes in `wa.me/?text=join_<short_code>` and `t.me/?start=<short_code>` invite links), `session_members` (with a `password_verified` flag for the WhatsApp Cloud password gate), `free_busy_cache`, `hangouts`, and an append-only `audit_log`. No RLS policies because we're not multi-tenant yet, and adding RLS as a retrofit is easier than living with the wrong rules now. A tiny migration runner sits next to the SQL: lists `*.sql` files in `src/db/migrations/`, applies each one inside a transaction, records it in `schema_migrations`. There's a `--dry-run` mode that works without a database connection because asking for a database to dry-run a migration is the wrong shape.

The Telegram adapter was the bigger commit. Six source files, three test files, twenty new tests, fifty in total across the suite. I considered grammy and walked away from it. Grammy is good and most TypeScript Telegram bots use it. But I only need two HTTP endpoints (`sendMessage` now, `setWebhook` later) and a thin client makes the adapter contract more visible than wrapping a framework in another framework. Native `fetch`, hand-typed Bot API slice, sixty lines for the client.

The interesting part of the adapter, and the part I want to come back to in the security post, is what `verifyWebhookSignature` does. Telegram's webhook security model is unusual. There's no HMAC the way Stripe or GitHub does it. When you register the webhook with `setWebhook`, you provide a "secret token", and Telegram echoes it back to you in the `X-Telegram-Bot-Api-Secret-Token` header on every update. You compare in constant time using `crypto.timingSafeEqual`. If you do this naively with a `===` comparison, you have a timing oracle: an attacker can measure response time differences character by character and discover your token one byte at a time. The test for that case exists.

I noticed a contract design hole while writing the adapter. The original `IncomingMessage.user` required a fully-resolved `User` with the engine's internal UUID, but the adapter doesn't have the UUID; it only knows the platform's user ID. So I split the types: `IncomingUser` is what the adapter knows (rail, platform user ID, display name), `User` is what the engine returns after resolving against the database (`IncomingUser` plus the internal `id`). Same split for groups. The `normalize` function returns an `IncomingMessage` with `IncomingUser`; the engine does the upsert into the `users` table after receive. Eight extra lines, cleaner contract.

What's NOT wired yet, and is the next move whenever the next sitting happens: the Fastify route `/webhook/telegram` that takes a real incoming request, runs `adapter.verifyWebhookSignature` at the edge, drops unverified, then hands the normalized message to a command router that routes `/start` to a welcome handler, `/find_time` to the session orchestrator, and so on. The `setWebhook` bootstrap script. The end-to-end happy path running against a real BotFather token in a real test group. None of that exists today. What exists today is the parts that pass tests offline.

Seven commits on `master`, all signed off, fifty tests green, two npm scripts (`migrate` and `migrate:dry`), one helper tool (`text-to-image.ps1`) that has earned its keep, and a working engine spine. Pushing now.

— Emmanuel

---

## 2026-05-12 — Day 0, evening: scaffold, the algorithm, and the security seam

Four commits in one sitting. The engine exists now.

The first commit is the boring one, but it carries most of the project's character. `CLAUDE.md` codifying the conventions, `.claude/skills/` with project-specific automations from session one, a `LICENSE` fetched fresh from gnu.org (the real AGPL-3.0 text, all 544 lines of it), `docs/architecture.md` carrying the same ASCII system diagrams that were in the planning doc, and a Fastify HTTP server that just returns `{"status":"ok"}` at `/health`. TypeScript strict mode, ESM, Node 22. The scaffold ran first try, which is the part of this I'm proud of, because the times it doesn't are tedious.

The second commit is where the project earned its first piece of real IP. I lifted the time-finding algorithm from the abandoned WhatsApp bot I built in January, but I did not just port it. The original was tangled into the database layer and assumed the data flow of a survey-style check-in. I pulled apart the pure overlap math from the I/O, rewrote it as one file (`src/logic/overlap.ts`) that takes member availability and a search window and returns ranked windows where N+ people are free. Then I wrote nineteen unit tests against it, mostly to make myself comfortable with the edge cases the original handled implicitly. Half-open interval overlap (touching at one instant doesn't count), validation, members with zero busy slots, empty groups. The ranking heuristics moved into their own file with their own tests, because the weekend-bonus and Friday-evening-bonus constants are product decisions, not engineering ones, and they should be easy to find when I want to tune them.

Same commit, I rewrote the Gemini function declarations from the WhatsApp bot. The original was loaded with security problems I now understand better than I did in January. It used chat mode (`startChat` / `sendMessage`), which means user text got concatenated straight into the LLM prompt: a prompt-injection door anyone could walk through. It exposed real names and group IDs to the LLM, which violates the privacy promise I want this project to make. It looped up to ten function calls with no budget enforcement. I kept the shape of the function declarations but rewrote everything else: function-calling mode only, opaque UUIDs only, no chat surface anywhere.

The third commit is the security-critical seam: the dispatcher that sits between Gemini and the engine. This is the only place where untrusted model output meets trusted engine code, and it is the one piece I cared most about getting right today. Zod validates the args before any work happens, so the LLM cannot smuggle stray fields past the type system. A per-function `authorize()` runs against the caller and the session context, not against any field the model proposes, so the LLM cannot escalate by lying. Handler output is re-validated against a result schema before it goes back to the LLM, so a buggy handler that accidentally returns a raw database row gets it stripped before the model sees it. There's a per-session call budget (in-memory for now, Redis at deploy) so a confused model can't loop forever. And every dispatch, success or failure, writes an audit entry. Eleven more tests, all green. Two stub handlers wired up, including `propose_times` which calls the real overlap detector with mock member data, so the dispatcher actually does something end to end.

The fourth commit is the hacker pass. I did the thing I keep saying I'm going to do at the end of every project and almost never do at the start: I tried to break what I'd built. Twelve findings, most of them trivial, three operational concerns that don't become real until the engine is exposed publicly, and five that were worth fixing today before they became habit. I added a whitelist for `LOG_LEVEL` so a misconfigured `LOG_LEVEL=trace` can't leak request internals. I set an explicit Fastify body limit (256 KB, plenty for a webhook payload). I documented that CORS is deliberately not enabled and explained why (server-to-server only; a browser client gets an origin-locked CORS config when one is introduced, not before). I tightened a test that left `process.stderr.write` mocked on assertion failure. And I wrote the `SECURITY.md` that the README had been promising, complete with the threat model and the known-but-not-yet-fixed operational concerns, written like an adult instead of a brochure.

I also wrote `CONTRIBUTING.md`. It requires a DCO sign-off on every commit. Then I realized none of my four commits had a sign-off, which is exactly the kind of thing the CONTRIBUTING file is supposed to catch. I rebased from root with `git commit --amend --no-edit -s` on each commit so all four now carry `Signed-off-by`. SHAs changed, which is fine because nothing has been pushed. I tagged the pre-rebase HEAD as `backup-before-signoff-rebase` first, because I'd rather have an undo button I don't need than discover I need one I don't have.

State of play: thirty tests, all green. Typecheck clean. Build clean. Zero npm audit findings. Four commits, all signed off, all attributed only to me. No co-authors, no AI footprints, no embarrassing trailers in the history.

What's not here yet: a database. A Telegram adapter. A real OAuth flow. Anything anyone can actually use as a bot. That's tomorrow's work. Today was about putting the engine on a foundation that won't collapse under the things that come next.

— Emmanuel

---

## 2026-05-12 — Day 0: the pivot

Three repos open in VS Code. None of them worked.

The first was `hangout-pwa`. Next.js 16, Supabase, real Google Calendar reads, an actual overlap-detection algorithm in `/api/suggestions/generate`. Privacy-first by design, only reads free/busy, never event titles. Two commits, then abandoned. The one that was closest to a real product.

The second was `proactive-friend-bot`. A Gemini-powered WhatsApp bot built for the Google AI Hackathon. Function-calling, Postgres, encrypted OAuth tokens. The architecture was right. The choice of WhatsApp library was wrong: Baileys, unofficial, reverse-engineered, account-suspension risk. The README literally said "use a burner phone number".

The third was `odon-app`, a React PWA with shadcn/ui and a beautiful onboarding flow. Twelve commits over four months. The most polished. Also the one with the least real backend wiring: every screen renders hardcoded mock arrays and ignores the data App.tsx fetches from Supabase. No service worker, despite "PWA" in the repo name. Gemini SDK initialized but the function that calls Gemini was never called.

Three attempts at the same product. Each one wrong in a different way.

In April, OpenClaw shipped a multi-channel update covering WhatsApp, Telegram, Discord, Signal, and about twenty others. 371k stars. MIT licensed. Self-hostable. The question stopped being "which framework should I use to build a hangout app" and became "why am I building a new app at all".

Today, after a long planning conversation, the answer is: I'm not. I'm building the engine and shipping it to many rails. Telegram first. Same code, eventually, in OpenClaw as a skill, in WhatsApp Cloud API as a bot, in Discord, and as a web demo. The standalone PWA dies. The persistent friend graph survives.

License is AGPL-3.0. If somebody forks this and hosts it as a paid service, they have to open-source their changes. Reach plus protection.

The name stays Odon. Renaming consumer products at zero stars is a distraction. The tagline does the work: "group hangouts in your group chats".

Today: project scaffold. Tomorrow: the adapter contract and the overlap algorithm lifted from `proactive-friend-bot`. The week after that: a Telegram bot saying "hello" in a test group.

— Emmanuel
