// Standalone migration runner for prod startup (Railway).
//
// Uses drizzle-orm/better-sqlite3/migrator (in production dependencies)
// instead of drizzle-kit (devDependency, omitted from prod install with
// `--omit=dev` — which is what Railway runs). This lets `npm start`
// chain migrations before `next start` so the database is always at
// the latest schema before the app accepts requests.
//
// Idempotent — drizzle's migrator tracks applied migrations in its own
// __drizzle_migrations table and skips anything already applied. Safe
// to run on every container start.
//
// Reads REPOBARON_DATA_DIR for the volume mount path (typically /data
// on Railway), falling back to .gitvision/ for local dev. Creates the
// directory if it doesn't exist yet (first deploy on a fresh volume).

import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir =
  process.env.CODETRAWL_DATA_DIR ?? process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "auth.db");
console.log(`[migrate] Database path: ${dbPath}`);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

try {
  console.log(`[migrate] Applying migrations from ./drizzle/`);
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`[migrate] ✓ Migrations applied successfully.`);
} catch (err) {
  console.error(`[migrate] ✗ Migration failed:`, err);
  sqlite.close();
  process.exit(1);
}

sqlite.close();
