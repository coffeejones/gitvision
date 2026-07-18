// Drizzle ORM client for the auth database.
//
// Why SQLite + better-sqlite3:
//   - One file on disk (`.gitvision/auth.db` locally, `<DATA_DIR>/auth.db`
//     on Railway). Matches our file-based architecture invariant.
//   - Synchronous API — no connection pool to manage, fine for our
//     read-heavy + low-write-volume access pattern.
//   - Battle-tested driver; Better Auth has an officially supported
//     Drizzle SQLite adapter that points at this same database.
//
// Lazy initialization is critical: Next.js's "Collecting page data"
// step (during `next build`) spawns ~30 parallel workers that each
// import every route. If we open the DB at module load, all workers
// race to `PRAGMA journal_mode = WAL` on the same file → SQLITE_BUSY
// kills the build. With lazy init, only routes that actually query
// the DB at request-time open a handle. Build-time metadata
// collection never touches it.
//
// We use a global singleton in dev so Turbopack/Next HMR doesn't
// re-instantiate the connection on every file change (which would
// orphan the previous handle and leak fds over time).

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __rbSqlite?: Database.Database;
  __rbDrizzle?: DrizzleDb;
};

/** Resolve the SQLite file path. Reads env lazily on first call so
 *  tests can swap `REPOBARON_DATA_DIR` between runs without module-
 *  import-timing dances — same pattern lib/storage.ts uses. */
function dbPath(): string {
  const dataDir =
    process.env.CODETRAWL_DATA_DIR ?? process.env.REPOBARON_DATA_DIR ??
    path.join(process.cwd(), ".gitvision");
  // Ensure dir exists; SQLite won't auto-create the parent directory.
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "auth.db");
}

/** Open the SQLite handle on first access. Configures WAL + foreign
 *  keys exactly once, never at module-import time. */
function getSqlite(): Database.Database {
  if (globalForDb.__rbSqlite) return globalForDb.__rbSqlite;

  const handle = new Database(dbPath());
  // WAL mode lets readers and writers operate concurrently — relevant
  // when Next renders multiple Server Components in parallel that each
  // call auth.api.getSession(). Set once per process; SQLite serializes
  // PRAGMA calls so even if two requests race, only one applies.
  handle.pragma("journal_mode = WAL");
  // Enforce FK constraints we declared in schema.ts (e.g. session.userId
  // → user.id with onDelete: cascade). SQLite is foreign-keys-off by
  // default for historical reasons; we explicitly opt in.
  handle.pragma("foreign_keys = ON");

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__rbSqlite = handle;
  } else {
    // In production we still want the singleton — without dev's
    // globalThis stash, multiple requests would each open a fresh
    // handle and leak fds.
    globalForDb.__rbSqlite = handle;
  }
  return handle;
}

/** Open the drizzle wrapper on first access. Once initialized, the
 *  same instance is returned forever. */
function getDb(): DrizzleDb {
  if (globalForDb.__rbDrizzle) return globalForDb.__rbDrizzle;
  const instance = drizzle(getSqlite(), { schema });
  globalForDb.__rbDrizzle = instance;
  return instance;
}

/** Lazy-initialized db export. Proxy delegates every property access
 *  through getDb(), so the underlying SQLite handle only opens when
 *  someone actually queries — never at import time, never during
 *  Next's page-data collection. */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as unknown as Record<string | symbol, unknown>)[
      prop as string | symbol
    ];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
