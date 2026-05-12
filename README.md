# Odon

Group hangouts in your group chats.

Odon is an open-source bot that helps friend groups find a time and a place to hang out, without leaving the chat they already use. It reads each member's calendar availability (free/busy only — never event titles), suggests times that work for everyone, and proposes venues nearby. It runs on Telegram first, with WhatsApp Cloud API, OpenClaw, and Discord adapters planned.

This is the engine. The per-rail adapters live in sibling repos (`odon-telegram`, etc.).

## Status

Pre-alpha. Scaffold only. Not usable yet. See [BUILD_LOG.md](./BUILD_LOG.md) for what's been done.

## How it works (one paragraph)

A user in a group chat says "find a time for movie night this weekend". The bot reads the group context, identifies who's connected, prompts the rest to connect their calendars (free/busy only), waits until quorum or deadline, then proposes the top three times when everyone is free. Optionally, the bot suggests venues. Each member gets a personalized calendar deeplink to add the event to their own calendar. The bot never holds write access to anyone's calendar by default. Persistent memory of the group makes the second hangout dramatically faster than the first.

## Why not when2meet, Doodle, or Rallly?

When2meet is great if your group hangs out once. Odon is built for groups that hang out repeatedly: the second time you use it with the same crew, it's much faster, because the bot already knows the group, the calendars are connected, and the venue history is remembered.

It also lives in your chat. You don't open a webpage. You don't install another app. You message a bot in a chat platform you already use.

## Architecture (short)

```
Inbound rails (Telegram, OpenClaw, WhatsApp Cloud, Discord, web demo)
  ↓ via adapter contract
odon-core engine
  ├─ Intent router
  ├─ Gemini function-calling orchestrator (function-calling mode only)
  ├─ Pure logic (overlap, ranking, venue scoring)
  ├─ Orchestrator (session lifecycle, quorum, deadlines, status posts)
  └─ Data layer (Postgres + Redis)
  ↓
Outbound (Google / Microsoft / iCloud free/busy, Google Places venues)
```

Full diagram in [docs/architecture.md](./docs/architecture.md) (coming soon).

## Security model (short)

- Free/busy only. The bot never reads event titles, attendees, or locations.
- No calendar write access by default. Hangouts are added via per-user calendar deeplinks.
- Function-calling mode only on the LLM. No free-form chat. Compliant with Meta's January 2026 WhatsApp Cloud API policy.
- OAuth tokens encrypted at rest with envelope encryption.
- Every webhook is HMAC-verified at the edge.

Full threat model in [SECURITY.md](./SECURITY.md) (coming soon).

## License

[AGPL-3.0-or-later](./LICENSE). If you fork Odon and run it as a hosted service, you must publish your modifications under the same license. Use, study, modify, and share freely.

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) (coming soon). The plan is welcoming. Bring tests.
