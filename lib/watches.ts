// Watch storage — CRUD over the `watch` table (Drizzle/SQLite). A watch keeps
// a session fresh and (later) alerts on regressions; it points at a file-based
// session by id. Ownership is enforced by always scoping queries to userId.
//
// Server-only — imports the db handle. Don't import from a Client Component.

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/lib/db";

export type Watch = typeof schema.watch.$inferSelect;

/** Create a watch on a session. Caller must enforce the tier quota first
 *  (withinQuota "watchedRepos") — this is the raw insert. */
export async function createWatch(input: {
  userId: string;
  sessionId: string;
  repoFullName: string;
}): Promise<Watch> {
  const row: Watch = {
    id: nanoid(12),
    userId: input.userId,
    sessionId: input.sessionId,
    repoFullName: input.repoFullName,
    createdAt: new Date(),
    lastSweptAt: null,
    lastHeadSha: null,
    lastAlertedSha: null,
    paused: false,
  };
  await db.insert(schema.watch).values(row);
  return row;
}

/** The watch on a given session for this user, or null. Drives the
 *  watch/unwatch toggle state on the session page + case row. */
export async function getWatchForSession(
  userId: string,
  sessionId: string,
): Promise<Watch | null> {
  const rows = await db
    .select()
    .from(schema.watch)
    .where(
      and(
        eq(schema.watch.userId, userId),
        eq(schema.watch.sessionId, sessionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Every non-paused watch across all users — the monitor's work list. */
export async function listActiveWatches(): Promise<Watch[]> {
  return db.select().from(schema.watch).where(eq(schema.watch.paused, false));
}

/** Persist monitor state after a sweep: the head we swept, when, and (when an
 *  alert fired) the head we alerted on — for change-detect + dedup. */
export async function updateWatchState(
  id: string,
  patch: Partial<Pick<Watch, "lastSweptAt" | "lastHeadSha" | "lastAlertedSha">>,
): Promise<void> {
  await db.update(schema.watch).set(patch).where(eq(schema.watch.id, id));
}

/** All of a user's watches, newest first. */
export async function listWatchesForUser(userId: string): Promise<Watch[]> {
  return db
    .select()
    .from(schema.watch)
    .where(eq(schema.watch.userId, userId))
    .orderBy(desc(schema.watch.createdAt));
}

/** How many repos the user is currently watching (for the quota check). */
export async function countWatchesForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.watch.id })
    .from(schema.watch)
    .where(eq(schema.watch.userId, userId));
  return rows.length;
}

/** Remove a watch by its session, scoped to the owner. Idempotent. */
export async function deleteWatchForSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await db
    .delete(schema.watch)
    .where(
      and(
        eq(schema.watch.userId, userId),
        eq(schema.watch.sessionId, sessionId),
      ),
    );
}
