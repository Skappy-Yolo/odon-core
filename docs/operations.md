# Operations

How to run odon-core. Written for the first deployment, not a battle-hardened ops runbook. Updates when there's a hosted instance.

## What you need

- Node 22 or later
- A Postgres 14+ database (Supabase is fine; so is plain Postgres)
- A Telegram bot token from `@BotFather`
- A publicly reachable HTTPS URL for the engine (Fly.io, Railway, Render, or a `ngrok` tunnel for local dev)
- A Gemini API key (later phases; not required to bring the bot up)

## One-time Telegram setup

1. Open Telegram, message `@BotFather`, send `/newbot`. Pick a name and a username (must end in `bot`).
2. BotFather replies with an HTTP API token that looks like `123456789:ABCdefGHIjklmNOPqrsTUVwxyZ`. Treat it like a password.
3. In the same chat with BotFather, send `/setprivacy` and choose your bot, then choose **Disable**. This lets the bot read group messages (it only sees what it's mentioned in by default, and that breaks `/find_time` flowing through a group).
4. Send `/setdescription` and `/setabouttext` if you want a nice listing in Telegram.

Optional but recommended: send `/mybots`, pick your bot, **Bot Settings → Group Privacy → Turn off**. Same effect as `/setprivacy` above; sometimes one path works when the other doesn't.

## Environment variables

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL=postgres://user:pass@host:5432/odon
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<any string of 1–256 chars from [A-Za-z0-9_-], your choice>
ODON_PUBLIC_URL=https://your-deploy.example
```

`TELEGRAM_WEBHOOK_SECRET` is yours to pick. Use a long random string. The same string goes in your env and in the Telegram `setWebhook` call; Telegram echoes it on every webhook in the `X-Telegram-Bot-Api-Secret-Token` header so the engine can drop unverified requests.

The other env vars in `.env.example` (`GEMINI_API_KEY`, `GOOGLE_OAUTH_*`, `GOOGLE_PLACES_API_KEY`, `TOKEN_ENCRYPTION_KEY`, etc.) are for later phases. The Telegram adapter and `/health` endpoint work without them.

## Bring up the database

```
npm install
npm run migrate:dry      # sanity check: lists migrations on disk, no DB needed
npm run migrate          # applies pending migrations against DATABASE_URL
```

The migrate script tracks state in a `schema_migrations` table inside your database, so re-running is safe.

## Bring up the engine

Two options.

### Local dev with public access (ngrok)

In one terminal:
```
npm run dev
```

In another:
```
ngrok http 3000
```

ngrok prints a public HTTPS URL. Set that as `ODON_PUBLIC_URL`, then in a third terminal:

```
npm run telegram:set-webhook
```

The engine logs `telegram adapter registered at POST /webhook/telegram` and Telegram now forwards updates there.

### Production-ish on Fly.io or Railway

Deploy with whichever platform you prefer; the engine is just a Node app listening on `PORT` (defaults to 3000). Set the env vars in the platform's secret store. After the first deploy:

```
ODON_PUBLIC_URL=https://your-deploy.example npm run telegram:set-webhook
```

You only need to re-run `telegram:set-webhook` if `ODON_PUBLIC_URL` or `TELEGRAM_WEBHOOK_SECRET` changes.

## Verify

1. `GET https://your-deploy.example/health` should return `{"status":"ok","service":"odon-core","version":"0.0.1"}`.
2. In Telegram, message your bot directly with `/start`. The bot should reply with a welcome message listing the commands.
3. Add the bot to a group. Send `/start@YourBotName` (Telegram routes commands by bot username when more than one bot is in a chat). Bot should reply in the group.
4. Send `/find_time movie this weekend`. Today the bot replies with a stub (`coming next`); this is the seam where the session orchestrator wires in next.

## Trouble

- **Bot is silent in a group.** Group Privacy is on (Telegram's default). Disable it via BotFather: `/setprivacy` → pick bot → **Disable**.
- **Webhook returns 401.** `TELEGRAM_WEBHOOK_SECRET` in env doesn't match what was registered with Telegram. Re-run `npm run telegram:set-webhook` after setting the env correctly.
- **No reply at all and no 401.** Check the engine logs. Common causes: `npm run migrate` not run yet (DB queries will fail), Postgres unreachable, or the bot token rejected by Telegram on the outgoing reply.
- **You want to start over.** `npm run telegram:delete-webhook` clears the Telegram registration cleanly.

## Reset

To wipe local state for dev:
```
psql $DATABASE_URL -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
npm run migrate
npm run telegram:delete-webhook
npm run telegram:set-webhook
```

That truncates the database, re-applies migrations, and re-registers the webhook.
