/**
 * Tiny migration runner. Reads .sql files in src/db/migrations/, applies
 * any that haven't been recorded in `schema_migrations` yet, in lexical
 * order, each within a transaction.
 *
 * Usage:
 *   npm run migrate                 # apply pending migrations
 *   npm run migrate -- --dry-run    # list what would be applied, no changes
 *
 * Hard rule: this script never modifies an already-applied migration. To
 * change a migration, add a new one. The schema_migrations table is the
 * source of truth for what has been run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

interface MigrationFile {
  readonly name: string;
  readonly fullPath: string;
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((e) => e.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, fullPath: path.join(MIGRATIONS_DIR, name) }));
}

async function listAppliedMigrationNames(): Promise<Set<string>> {
  const pool = getPool();
  // The first migration creates schema_migrations, so on a fresh DB this
  // SELECT errors. Detect that case and treat as "nothing applied yet".
  try {
    const result = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    return new Set(result.rows.map((r) => r.name));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("schema_migrations") && message.includes("does not exist")) {
      return new Set();
    }
    throw err;
  }
}

async function applyMigration(file: MigrationFile, dryRun: boolean): Promise<void> {
  const sql = await fs.readFile(file.fullPath, "utf8");
  if (dryRun) {
    process.stdout.write(`[dry-run] would apply: ${file.name} (${sql.length} bytes)\n`);
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file.name]);
    await client.query("COMMIT");
    process.stdout.write(`applied: ${file.name}\n`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const files = await listMigrationFiles();

  // Dry-run is a no-DB operation: it lists migration files on disk. The
  // tool exists so you can sanity-check what would happen without
  // needing a database running, and without DATABASE_URL set.
  const applied = dryRun ? new Set<string>() : await listAppliedMigrationNames();

  const pending = files.filter((f) => !applied.has(f.name));
  if (pending.length === 0) {
    process.stdout.write(`nothing to apply (${files.length} migration(s) already up to date)\n`);
    return;
  }

  if (dryRun) {
    process.stdout.write(`[dry-run] ${pending.length} migration(s) on disk:\n`);
  } else {
    process.stdout.write(`${applied.size} migration(s) already applied, ${pending.length} pending\n`);
  }
  for (const file of pending) {
    await applyMigration(file, dryRun);
  }
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
