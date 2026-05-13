import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import { TelegramAdapter } from "./adapters/telegram/adapter.js";
import { createCommandRouter, routeCommand } from "./adapters/telegram/commands.js";
import { getPool } from "./db/pool.js";

const ALLOWED_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;
type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

function pickLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return (ALLOWED_LOG_LEVELS as ReadonlyArray<string>).includes(raw ?? "")
    ? (raw as LogLevel)
    : "info";
}

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Maximum HTTP request body size in bytes. Explicit, not Fastify's default,
 * because adapter webhooks should not be allowed to balloon. Telegram and
 * WhatsApp webhook payloads are small (< 64 KB typical). 256 KB is plenty,
 * keeps a misbehaving adapter from triggering OOM.
 */
const BODY_LIMIT_BYTES = 256 * 1024;

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: pickLogLevel() },
    bodyLimit: BODY_LIMIT_BYTES,
  });

  await app.register(helmet);

  // CORS is intentionally NOT enabled here. Endpoints live behind webhooks
  // (HMAC / secret-token verified) and the engine HTTP API (server-to-
  // server, internal). Browser-origin access is not a use case. Add
  // @fastify/cors only when a specific browser client (e.g. odon-web) is
  // introduced, and lock origins explicitly at that point.

  app.get("/health", async () => ({ status: "ok", service: "odon-core", version: "0.0.1" }));

  registerTelegramAdapter(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`odon-core listening on :${PORT}`);
}

/**
 * Constructs the Telegram adapter from env and registers its webhook
 * route. Skipped (with a single info-level log line) if the necessary
 * env vars are not set; this lets `/health` come up for dev without
 * configuring Telegram.
 *
 * Uses the orchestrator-wired router (real /find_time) when DATABASE_URL
 * is also set; otherwise falls back to the sync stub router so /start
 * still works without a database.
 */
function registerTelegramAdapter(app: FastifyInstance): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken || !webhookSecretToken) {
    app.log.info(
      "telegram adapter not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET required) — skipping registration",
    );
    return;
  }

  const adapter = new TelegramAdapter({ botToken, webhookSecretToken });

  const hasDatabase = Boolean(process.env.DATABASE_URL);
  const router = hasDatabase
    ? createCommandRouter({ orchestrator: { db: getPool() }, botUsername: process.env.TELEGRAM_BOT_USERNAME })
    : null;
  if (!hasDatabase) {
    app.log.info("DATABASE_URL not set — /find_time will reply with a stub instead of creating a session");
  }

  app.post("/webhook/telegram", async (req: FastifyRequest, reply: FastifyReply) => {
    // Header normalization: Fastify gives us a Record<string, string|string[]|undefined>.
    // The adapter contract uses Record<string, string>. Coerce, joining arrays.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers[k] = v.join(", ");
      else if (typeof v === "string") headers[k] = v;
    }

    const bodyString = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    if (!adapter.verifyWebhookSignature(headers, bodyString)) {
      req.log.warn("telegram webhook: signature verification failed; dropping");
      return reply.code(401).send({ ok: false });
    }

    const incoming = adapter.normalize(req.body);
    if (!incoming) {
      // Update kind we don't handle yet (callback queries, edited messages,
      // channel posts, etc). Ack so Telegram stops retrying.
      return reply.code(200).send({ ok: true });
    }

    try {
      const outgoing = router ? await router(incoming) : routeCommand(incoming);
      if (outgoing) {
        await adapter.send(outgoing);
      }
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "telegram webhook: error while routing/sending",
      );
      // Still ack 200: the message landed, we just couldn't reply.
      // Logging is the line of defence; Telegram retrying won't help.
    }

    return reply.code(200).send({ ok: true });
  });

  app.log.info("telegram adapter registered at POST /webhook/telegram");
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
