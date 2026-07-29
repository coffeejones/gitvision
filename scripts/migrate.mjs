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

// ── Session files: re-serialise any left indented ────────────────────────────
//
// lib/atomicWrite.ts writes sessions compact now. Existing files stay indented
// until something rewrites them, and a session is only rewritten on a refresh —
// so without this pass an analysis nobody re-sweeps keeps paying for whitespace
// forever. Measured on the stored colinhacks/zod session: 55.3 MB indented,
// 33.8 MB compact, and read+parse 118ms → 55ms.
//
// Deliberately dumb: parse, re-serialise, atomic-rename. No schema knowledge, no
// types — which is the only reason this can live in a plain .mjs that Railway
// runs before `next start`. (A migration needing CodeGraph types could not.)
//
// Idempotent and cheap to skip: an indented file starts with `{\n`, a compact
// one with `{"`, so already-migrated files cost one 2-byte read. Failures are
// logged and skipped rather than fatal — a single unreadable session must not
// stop the container from booting.
try {
  const sessionsDir = path.join(dataDir, "sessions");
  if (fs.existsSync(sessionsDir)) {
    let done = 0;
    let saved = 0;
    for (const name of fs.readdirSync(sessionsDir)) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(sessionsDir, name);
      let fd;
      try {
        // Cheapest possible "is it already compact?" — the second byte.
        fd = fs.openSync(file, "r");
        const head = Buffer.alloc(2);
        fs.readSync(fd, head, 0, 2, 0);
        fs.closeSync(fd);
        fd = undefined;
        if (head.toString("utf-8") !== "{\n") continue;

        const before = fs.statSync(file).size;
        const compact = JSON.stringify(JSON.parse(fs.readFileSync(file, "utf-8")));
        // Same temp-then-rename dance as lib/atomicWrite.ts, so a kill mid-pass
        // can never leave a half-written session behind.
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, compact, "utf-8");
        fs.renameSync(tmp, file);
        done++;
        saved += before - Buffer.byteLength(compact);
      } catch (err) {
        if (fd !== undefined) try { fs.closeSync(fd); } catch {}
        console.error(`[migrate] ✗ could not compact ${name}:`, err.message);
      }
    }
    if (done > 0) {
      console.log(
        `[migrate] ✓ Compacted ${done} session file(s), ${(saved / 1048576).toFixed(1)} MB reclaimed.`,
      );
    }
  }
} catch (err) {
  console.error("[migrate] ✗ session compaction pass failed:", err.message);
}
