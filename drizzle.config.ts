// drizzle-kit configuration — schema discovery + migration output.
//
// Migration workflow (after editing lib/db/schema.ts):
//   1. npm run db:generate   — emits a versioned SQL file in ./drizzle/
//   2. npm run db:migrate    — applies pending migrations to the DB
//
// We use the versioned `generate + migrate` flow (not `push`) so every
// schema change lands as a reviewable SQL diff committed to the repo.
// `push` silently mutates the live DB, which is fine for throwaway
// prototyping but ugly for rollbacks.
//
// The database lives at REPOBARON_DATA_DIR/auth.db (defaults to
// .gitvision/auth.db locally). drizzle-kit reads the same env so it
// targets the same file Better Auth runtime uses.

import type { Config } from "drizzle-kit";
import path from "node:path";

const dataDir =
  process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${path.join(dataDir, "auth.db")}`,
  },
} satisfies Config;
