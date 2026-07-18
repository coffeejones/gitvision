// Per-user "last seen" state for the Chambers case deltas.
//
// Stores, per user, the fetchedAt of the snapshot they last SAW for each
// case (advanced when they open the case detail). The Chambers Cases list
// diffs the latest snapshot against this baseline — so a case you've
// already reviewed shows no "since last visit" movement until something
// new lands, and the baseline is "since YOU last looked", not "the
// previous snapshot".
//
// Per-user (not a field on the shared session) so it survives the move to
// team/org-shared cases: "seen" is always per viewer. Same file-based
// store as lib/storage.ts — <dataDir>/seen/<userId>.json, a flat
// { [sessionId]: lastSeenFetchedAt } map, atomic writes.

import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "./atomicWrite";

export type SeenMap = Record<string, string>;

function seenDir(): string {
  const dataDir =
    process.env.CODETRAWL_DATA_DIR ?? process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "seen");
}

/** Filesystem-safe filename for a user id. Ids come from the auth session
 *  (trusted), but we sanitize defensively so nothing can escape seen/. */
function seenPath(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(seenDir(), `${safe}.json`);
}

/** Read a user's seen-map (sessionId → last-seen fetchedAt). Empty when
 *  they've never opened a case. Never throws — seen-state is cosmetic. */
export async function getSeenMap(userId: string): Promise<SeenMap> {
  try {
    const raw = await fs.readFile(seenPath(userId), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

/** Record that `userId` has seen `sessionId` up to `fetchedAt` (the latest
 *  snapshot at view time). No-op when it already matches, so reopening a
 *  case with no new snapshot doesn't churn the file. Never throws — this
 *  is best-effort cosmetic state; it must never break a page render. */
export async function markSeen(
  userId: string,
  sessionId: string,
  fetchedAt: string,
): Promise<void> {
  try {
    const map = await getSeenMap(userId);
    if (map[sessionId] === fetchedAt) return;
    map[sessionId] = fetchedAt;
    await fs.mkdir(seenDir(), { recursive: true });
    await atomicWriteJson(seenPath(userId), map);
  } catch {
    // swallow — losing a seen-marker just re-shows a delta next load
  }
}
