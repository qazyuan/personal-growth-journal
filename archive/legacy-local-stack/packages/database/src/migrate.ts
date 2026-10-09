import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = createPool(databaseUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const existing = await pool.query<{ checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE name = $1",
    [file],
  );

  if (existing.rowCount) {
    if (existing.rows[0]?.checksum !== checksum) {
      throw new Error(`Migration ${file} changed after it was applied`);
    }
    continue;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
    await client.query("COMMIT");
    process.stdout.write(`Applied ${file}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
