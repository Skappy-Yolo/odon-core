# Thread 01 — Kill the PWA: why I'm rebuilding my hangout app as an engine

Draft. Each blank-line-separated block is one tweet. Posting order top to bottom. Image slots marked `[IMG]`.

Status: draft, not posted.
Target publish: when odon-core is pushed to GitHub.

---

In January I built three friend-group hangout apps in 36 hours. None of them shipped.

In April, OpenClaw made me realize I was building the wrong thing.

So I killed all three and started over. Here is what I learned.

[IMG: screenshot of the three old repos on your GitHub profile, side by side]

---

Repo one was the prettiest. A React PWA with shadcn/ui, a nice onboarding flow, the full Figma treatment. It looked like a real product.

It rendered hardcoded mock data on every screen. The Supabase calls in App.tsx were fetching, the screens were ignoring the results.

Nice UI, no app underneath.

---

Repo two was the one that actually worked. Next.js + Supabase + Google Calendar free/busy. Real overlap-detection logic. Privacy-aware (only read free/busy, never event titles).

Two commits. Then it sat there for four months.

The lesson: shipping is harder than building.

---

Repo three was a WhatsApp bot. Gemini function-calling, Postgres, encrypted tokens. The AI was wired right.

It used Baileys, which is reverse-engineered WhatsApp Web. The README literally said "use a burner phone number" because Meta will ban you.

You cannot build a serious product on a library that asks you to use a burner phone.

[IMG: screenshot of the README warning from proactive-friend-bot]

---

Then OpenClaw shipped its multi-channel update in April. 371k stars. MIT licensed. WhatsApp, Telegram, Signal, Discord, iMessage. One personal AI, every channel you use.

The question I had been asking ("which framework should I use to build a hangout app?") was the wrong question.

The right question was: why am I building an app at all?

---

Here is the bet I am making now:

The place to coordinate a hangout is in the group chat people already use. Not on a new app I am asking them to install.

The product is an engine that plugs into every chat platform. The rails are commodities.

---

So I am rebuilding it as `odon-core`. An open-source TypeScript engine with thin per-rail adapters. AGPL-3.0.

Telegram first. Then OpenClaw skill. Then WhatsApp Cloud (the official one, not Baileys). Then Discord. Then a web demo.

[IMG: screenshot of the docs/architecture.md system diagram]

---

What I shipped today:

- The adapter contract that every rail will implement
- The overlap-detection algorithm, lifted from the WhatsApp bot and made pure
- Six Gemini function declarations, opaque UUIDs only, no PII ever in the prompt
- The dispatcher that sits between Gemini and the engine, with Zod arg validation, per-function permissions, a per-session call budget, and an audit sink
- A security model that does not lie about what is and is not protected yet

Four commits. Thirty tests. All green.

[IMG: screenshot of `npm test` output showing 30/30 passed]

---

Some choices I made today that I think will matter:

The LLM only ever sees opaque IDs and time slots. No names, no event titles, no tokens. The dispatcher resolves identifiers post-LLM, in the adapter, so a prompt-injection attempt cannot exfiltrate anything useful.

Function-calling mode only. There is no free-form chat endpoint in the engine. This is also what keeps the bot inside Meta's January 2026 "concrete business task" allowed list for WhatsApp.

Default OAuth scope is `calendar.freebusy`. The bot never holds calendar write access by default. Members add confirmed events to their own calendars via per-user deeplinks.

---

Bigger plan: when2meet is great for groups that hang out once. The wedge for Odon is the second use with the same crew. Persistent friend graph, no re-setup, AI suggests times AND venues.

If your group hangs out monthly, Odon should win by the second or third hangout. If it hangs out once, just use when2meet.

---

Repo is at github.com/Skappy-Yolo/odon-core. AGPL-3.0. Build log in /BUILD_LOG.md, threat model in /SECURITY.md, architecture in /docs/architecture.md.

If you've ever spent forty minutes in a WhatsApp group trying to find a time everyone is free, this is for you.

[IMG: small GIF of /health endpoint returning ok, or git log showing the four signed-off commits]
