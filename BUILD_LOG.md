# Build log

A public devlog written as the work happens. Each entry is dated and signed. This is the source material for X threads, dev.to posts, and screencasts. If you are reading this from outside the project: scroll to the most recent entry, that is where we are.

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
