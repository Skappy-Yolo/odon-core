# Build log

A public devlog written as the work happens. Each entry is dated and signed. This is the source material for X threads, dev.to posts, and screencasts. If you are reading this from outside the project: scroll to the most recent entry, that is where we are.

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
