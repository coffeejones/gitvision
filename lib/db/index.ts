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
// We use a global singleton in dev so Turbopack/Next HMR doesn't
// re-instantiate the connection on every file change (which would
// orphan the previous handle and leak fds over time).
//
// In production the module loads once anyway, but we still guard the
// global assignment behind NODE_ENV so we don't pollute the runtime
// global object outside of dev.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/** Resolve the SQLite file path. Reads env lazily on first call so
 *  tests can swap `REPOBARON_DATA_DIR` between runs without module-
 *  import-timing dances — same pattern lib/storage.ts uses. */
function dbPath(): string {
  const dataDir =
    process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  // Ensure dir exists; SQLite won't auto-create the parent directory.
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "auth.db");
}

const globalForDb = globalThis as unknown as {
  __gvSqlite?: Database.Database;
};

const sqlite =
  globalForDb.__gvSqlite ??
  (() => {
    const handle = new Database(dbPath());
    // WAL mode lets readers and writers operate concurrently — relevant
    // when Next renders multiple Server Components in parallel that each
    // call auth.api.getSession().
    handle.pragma("journal_mode = WAL");
    // Enforce FK constraints we declared in schema.ts (e.g. session.userId
    // → user.id with onDelete: cascade). SQLite is foreign-keys-off by
    // default for historical reasons; we explicitly opt in.
    handle.pragma("foreign_keys = ON");
    return handle;
  })();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__gvSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { schema };
