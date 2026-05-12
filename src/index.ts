import Fastify from "fastify";
import helmet from "@fastify/helmet";

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(helmet);

  app.get("/health", async () => ({ status: "ok", service: "odon-core", version: "0.0.1" }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`odon-core listening on :${PORT}`);
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
