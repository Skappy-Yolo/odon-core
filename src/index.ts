import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import { TelegramAdapter } from "./adapters/telegram/adapter.js";
import { createCommandRouter, routeCommand } from "./adapters/telegram/commands.js";
import { getPool } from "./db/pool.js";
import {
  createOAuthStateSigner,
  createTokenVault,
  type GoogleOAuthConfig,
} from "./auth/index.js";
import { registerOAuthRoutes } from "./http/oauth-routes.js";
import { GoogleCalendarProvider } from "./providers/google-calendar.js";
import type { FreeBusyProvider } from "./llm/dispatcher.js";

const ALLOWED_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;
type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

function pickLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return (ALLOWED_LOG_LEVELS as ReadonlyArray<string>).includes(raw ?? "")
    ? (raw as LogLevel)
    : "info";
}

const PORT = Number(process.env.PORT ?? 3000);
const BODY_LIMIT_BYTES = 256 * 1024;

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: pickLogLevel() },
    bodyLimit: BODY_LIMIT_BYTES,
  });

  await app.register(helmet);

  app.get("/health", async () => ({ status: "ok", service: "odon-core", version: "0.0.1" }));

  registerTelegramAdapter(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`odon-core listening on :${PORT}`);
}

/**
 * Wire up the Telegram adapter and (if calendar env is configured) the
 * Google OAuth callback route. All "missing config" branches log info
 * and skip registration so /health stays available for dev.
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
  const googleConfig = readGoogleOAuthConfig();
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;

  let router: ((message: import("./core/contract.js").IncomingMessage) => Promise<import("./core/contract.js").OutgoingMessage | null>) | null = null;

  if (hasDatabase && googleConfig && encryptionKey) {
    const pool = getPool();
    const vault = createTokenVault(encryptionKey);
    const stateSigner = createOAuthStateSigner(encryptionKey);
    const googleProvider: FreeBusyProvider = new GoogleCalendarProvider({
      pool,
      vault,
      oauthConfig: googleConfig,
    });
    router = createCommandRouter({
      orchestrator: { db: pool },
      googleConfig,
      stateSigner,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      providers: { google: googleProvider },
      vault,
    });
    registerOAuthRoutes(app, {
      db: pool,
      googleConfig,
      vault,
      stateSigner,
    });
    app.log.info("google calendar provider registered — /proceed runs against real free/busy");
  } else {
    if (!hasDatabase) app.log.info("DATABASE_URL not set — /find_time will reply with a stub");
    if (!googleConfig) app.log.info("Google OAuth env not fully set — calendar connection disabled");
    if (!encryptionKey) app.log.info("TOKEN_ENCRYPTION_KEY not set — calendar connection disabled");
  }

  app.post("/webhook/telegram", async (req: FastifyRequest, reply: FastifyReply) => {
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
    if (!incoming) return reply.code(200).send({ ok: true });

    try {
      const outgoing = router ? await router(incoming) : routeCommand(incoming);
      if (outgoing) await adapter.send(outgoing);
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "telegram webhook: error while routing/sending",
      );
    }

    return reply.code(200).send({ ok: true });
  });

  app.log.info("telegram adapter registered at POST /webhook/telegram");
}

function readGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const publicUrl = process.env.ODON_PUBLIC_URL;
  if (!clientId || !clientSecret || !publicUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${publicUrl.replace(/\/$/, "")}/oauth/google/callback`,
  };
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
