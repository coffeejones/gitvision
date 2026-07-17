// File-based session storage.
// Local dev: sessions live in `.gitvision/sessions/<id>.json` relative to project root.
// Production: set REPOBARON_DATA_DIR to a persistent volume path (e.g. `/data` on Railway)
// so sessions survive redeploys and container restarts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWriteJson } from "./atomicWrite";
import type { Session, SessionSummary, AnalysisSnapshot } from "./types";
import { cmpStr } from "./deterministicSort";

// Read env lazily on each storage call so tests can swap
// REPOBARON_DATA_DIR per-test without module-import timing dances —
// matches the pattern lib/jobs.ts already uses. Negligible perf hit
// (couple of path.join calls per operation).
function storeDir(): string {
  const dataDir =
    process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "sessions");
}

async function ensureDir() {
  await fs.mkdir(storeDir(), { recursive: true });
}

function sessionPath(id: string) {
  return path.join(storeDir(), `${id}.json`);
}

export async function createSession(params: {
  repoUrl: string;
  name: string;
  initialSnapshot: AnalysisSnapshot;
  /** Anonymous owner-id supplied by the client via the X-Owner-Id header
   *  (v0.26+). Optional for backward compat with internal callers; in
   *  practice every session created through the API now carries one.
   *  Kept on user-owned sessions too so the same browser can claim
   *  pre-login sessions after sign-in. */
  ownerId?: string;
  /** Better Auth user id (v0.76+). Set when the session is created by
   *  a logged-in caller — that's the strong ownership claim used by
   *  authorization checks. Workspace listings prefer userId matches
   *  over ownerId matches when both exist. */
  userId?: string;
  /** GitHub App installation that created this session (Commit 8+).
   *  Set only by the PR-bot pipeline so installation.deleted can GC
   *  exactly the right sessions. Workspace-created sessions leave
   *  this undefined. */
  installationId?: number;
  /** PR-bot Mode B provenance — set on the HEAD session of a PR analysis so
   *  the Merge Confidence view can locate the base session. Optional. */
  prMetadata?: Session["prMetadata"];
}): Promise<Session> {
  await ensureDir();
  const now = new Date().toISOString();
  const session: Session = {
    id: nanoid(10),
    name: params.name,
    repoUrl: params.repoUrl,
    ownerId: params.ownerId,
    userId: params.userId,
    installationId: params.installationId,
    prMetadata: params.prMetadata,
    createdAt: now,
    updatedAt: now,
    snapshots: [params.initialSnapshot],
  };
  await atomicWriteJson(sessionPath(session.id), session);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    const raw = await fs.readFile(sessionPath(id), "utf-8");
    return JSON.parse(raw) as Session;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    await ensureDir();
    const dir = storeDir();
    const files = await fs.readdir(dir);
    const summaries: SessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf-8");
        const session = JSON.parse(raw) as Session;
        // PR-bot sessions are private analysis artifacts created by
        // the GitHub App pipeline (commit a2c6acc). They must never
        // appear in workspace listings — otherwise they leak into:
        //   1. "Your sessions" panel for every visitor (they have no
        //      ownerId, and lib/ownerId.ts's filterSessionsByOwner
        //      treats ownerless sessions as "everyone's" for
        //      pre-v0.26 backward compat).
        //   2. AdaptiveHome routing — any session counted here pushes
        //      first-time visitors into WorkspaceHome instead of the
        //      marketing landing.
        //   3. GET /api/sessions response.
        // The bot's "Full analysis ↗" link still works because it
        // navigates directly to /session/<id>, which uses getSession
        // (not listSessions).
        if (session.installationId !== undefined) continue;
        const latest = session.snapshots[session.snapshots.length - 1];
        summaries.push({
          id: session.id,
          name: session.name,
          repoUrl: session.repoUrl,
          repoFullName: latest?.repo.fullName ?? session.repoUrl,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          snapshotCount: session.snapshots.length,
          ownerId: session.ownerId,
          userId: session.userId,
          // v0.81: persist private-repo flag from the latest snapshot
          // so list-endpoint callers can filter without loading every
          // session JSON. Undefined when the latest snapshot is from
          // a pre-v0.81 analysis (all of which were public-repo).
          private: latest?.repo.private,
        });
      } catch {
        // skip corrupted session file
      }
    }
    summaries.sort((a, b) => cmpStr(b.updatedAt, a.updatedAt));
    return summaries;
  } catch {
    return [];
  }
}

export async function appendSnapshot(
  id: string,
  snapshot: AnalysisSnapshot
): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  session.snapshots.push(snapshot);
  session.updatedAt = new Date().toISOString();
  await atomicWriteJson(sessionPath(id), session);
  return session;
}

export async function renameSession(id: string, name: string): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  session.name = name;
  session.updatedAt = new Date().toISOString();
  await atomicWriteJson(sessionPath(id), session);
  return session;
}

/**
 * Patch fields onto the most recent snapshot. Used by lazy-populated features
 * (e.g. AI summary) that write back into an existing snapshot rather than
 * appending a new one.
 */
export async function patchLatestSnapshot(
  id: string,
  patch: Partial<AnalysisSnapshot>
): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  const last = session.snapshots[session.snapshots.length - 1];
  if (!last) return null;
  session.snapshots[session.snapshots.length - 1] = { ...last, ...patch };
  session.updatedAt = new Date().toISOString();
  await atomicWriteJson(sessionPath(id), session);
  return session;
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete every session tagged with this installation id.
 *
 * Called from the GitHub App's installation.deleted handler — when a
 * user uninstalls the app, their PR-bot-created sessions go away.
 * Workspace-created sessions (installationId undefined) are NOT
 * touched, even if they happen to be for the same repo: those came
 * from the web UI under a different consent flow.
 *
 * Returns the count actually deleted. Never throws — file-by-file
 * unlinks, and corrupted/missing session files are silently skipped
 * so a single bad file doesn't abort the sweep.
 */
export async function deleteSessionsByInstallation(
  installationId: number,
): Promise<number> {
  let deleted = 0;
  try {
    await ensureDir();
    const dir = storeDir();
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf-8");
        const session = JSON.parse(raw) as Session;
        if (session.installationId === installationId) {
          await fs.unlink(path.join(dir, file));
          deleted++;
        }
      } catch {
        // Corrupted session file or race with another deletion — skip
        // and keep sweeping. Worst case: one orphan stays until the
        // next sweep.
      }
    }
  } catch {
    // storeDir() doesn't exist yet — nothing to delete
  }
  return deleted;
}
