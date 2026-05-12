import pg from "pg";

/**
 * Lazily-constructed singleton pg.Pool. Reads DATABASE_URL once.
 *
 * Most code should not import this module directly; it should accept a
 * `Pool` (or a `Pool`-shaped interface) so it can be tested with a mock.
 * Production wiring imports `getPool()` once at startup and threads the
 * instance through the engine.
 */

let cached: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  cached = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "odon-core",
  });

  cached.on("error", (err) => {
    process.stderr.write(`pg pool error: ${err.message}\n`);
  });

  return cached;
}

/** Closes the cached pool. Used during graceful shutdown and in tests. */
export async function closePool(): Promise<void> {
  if (!cached) return;
  await cached.end();
  cached = undefined;
}
