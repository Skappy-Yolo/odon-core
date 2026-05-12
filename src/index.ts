import Fastify from "fastify";
import helmet from "@fastify/helmet";

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
  // (HMAC-signed) and the engine HTTP API (server-to-server, internal).
  // Browser-origin access is not a use case. Add @fastify/cors only when a
  // specific browser client (e.g. odon-web) is introduced, and lock origins
  // explicitly at that point.

  app.get("/health", async () => ({ status: "ok", service: "odon-core", version: "0.0.1" }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`odon-core listening on :${PORT}`);
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
