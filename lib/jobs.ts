// File-based job queue for long-running analyses.
//
// The pattern: POST /api/sessions enqueues a job (writes a JSON file with
// status="pending"), schedules processing via Next.js's `after()`, and
// returns the jobId straight back to the client. The client polls
// GET /api/jobs/<id> until status flips to "done" (with a sessionId) or
// "failed" (with an error). The actual analysis runs detached from the
// HTTP request, freeing us from Railway's request timeout (~60s) on
// repos that take 90s+ to clone + log + parse.
//
// Storage matches the sessions pattern: <DATA_DIR>/jobs/<id>.json. Survives
// container restart so a freshly redeployed server can recover orphaned
// jobs (status="running" left over from a SIGTERM'd container).
//
// Atomicity: writes go through a temp+rename pattern. Reads happen during
// polling and need to never see a half-written file. POSIX rename is
// atomic on the same filesystem, which is what we have.

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWriteJson } from "./atomicWrite";
import { analyzeRepo, parseRepoUrl } from "./github";
import { SubdirNotFoundError } from "./graph";
import {
  appendSnapshot,
  createSession,
  getSession,
} from "./storage";
import type { Job, JobInput, JobStatus } from "./types";

// Read env lazily on each storage call so tests can swap GITVISION_DATA_DIR
// per-test without module-import timing dances. Negligible perf hit
// (couple of path.join calls per operation).
function jobsDir(): string {
  const dataDir =
    process.env.GITVISION_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "jobs");
}

async function ensureDir() {
  await fs.mkdir(jobsDir(), { recursive: true });
}

function jobPath(id: string) {
  return path.join(jobsDir(), `${id}.json`);
}

// ------------------- Public API -------------------

export async function createJob(input: JobInput): Promise<Job> {
  await ensureDir();
  await ensureOrphansRecovered();
  const now = new Date().toISOString();
  const job: Job = {
    id: nanoid(10),
    status: "pending",
    input,
    createdAt: now,
    updatedAt: now,
  };
  await atomicWriteJson(jobPath(job.id), job);
  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  await ensureOrphansRecovered();
  try {
    const raw = await fs.readFile(jobPath(id), "utf-8");
    return JSON.parse(raw) as Job;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function patchJob(id: string, patch: Partial<Job>): Promise<Job | null> {
  const current = await getJob(id);
  if (!current) return null;
  const updated: Job = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(jobPath(id), updated);
  return updated;
}

export async function deleteJob(id: string): Promise<boolean> {
  try {
    await fs.unlink(jobPath(id));
    return true;
  } catch {
    return false;
  }
}

// ------------------- Background processing -------------------

/** Run the analysis for a job. Called from `after()` in API routes — runs
 *  detached from the HTTP request that enqueued the job. Updates job
 *  status as it progresses; never throws (errors are captured into
 *  job.error and status="failed"). */
export async function processJob(jobId: string): Promise<void> {
  const initial = await getJob(jobId);
  if (!initial) {
    console.error(`[jobs] processJob: job ${jobId} not found`);
    return;
  }
  if (initial.status !== "pending") {
    // Idempotency: if a previous run already set this to running/done/
    // failed, don't re-process. This guards against double-firing in
    // case the same after() is somehow scheduled twice.
    return;
  }
  await patchJob(jobId, { status: "running" });

  try {
    if (initial.input.kind === "create-session") {
      await runCreateSession(initial);
    } else if (initial.input.kind === "refresh-session") {
      await runRefreshSession(initial);
    } else {
      throw new Error(`Unknown job kind: ${(initial.input as { kind: string }).kind}`);
    }
  } catch (err) {
    const message =
      err instanceof SubdirNotFoundError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await patchJob(jobId, { status: "failed", error: message });
    console.error(`[jobs] job ${jobId} failed:`, message);
  }
}

async function runCreateSession(job: Job): Promise<void> {
  if (job.input.kind !== "create-session") return;
  const parsed = parseRepoUrl(job.input.repoUrl);
  if (!parsed) {
    throw new Error(
      "Could not parse GitHub URL. Expected e.g. https://github.com/owner/repo"
    );
  }
  const snapshot = await analyzeRepo(parsed.owner, parsed.repo, {
    subdir: job.input.subdir,
  });
  const session = await createSession({
    repoUrl: job.input.repoUrl,
    name: job.input.sessionName || snapshot.repo.fullName,
    initialSnapshot: snapshot,
    ownerId: job.input.ownerId,
  });
  await patchJob(job.id, { status: "done", sessionId: session.id });
}

async function runRefreshSession(job: Job): Promise<void> {
  if (job.input.kind !== "refresh-session") return;
  const sessionId = job.input.sessionId;
  if (!sessionId) {
    throw new Error("Refresh job missing sessionId");
  }
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const parsed = parseRepoUrl(session.repoUrl);
  if (!parsed) {
    throw new Error("Stored repoUrl is invalid");
  }
  const snapshot = await analyzeRepo(parsed.owner, parsed.repo, {
    subdir: job.input.subdir,
  });
  await appendSnapshot(sessionId, snapshot);
  await patchJob(job.id, { status: "done", sessionId });
}

// ------------------- Orphan recovery -------------------
//
// On Railway redeploy, the running container gets SIGTERM with a 30s grace
// period before SIGKILL. A 90s analysis won't finish in time, so jobs in
// status="running" at shutdown are left orphaned — the new container has
// no in-memory state of them. On first import of this module (i.e. first
// request after the new container boots), we sweep the jobs/ directory
// and mark anything stuck in "running" as failed with an explanation.
//
// `pending` jobs are also a problem (they were enqueued but never started)
// — same treatment. The user can re-submit.

let orphansRecoveredPromise: Promise<void> | null = null;

function ensureOrphansRecovered(): Promise<void> {
  if (!orphansRecoveredPromise) {
    orphansRecoveredPromise = recoverOrphanedJobs().then(
      () => undefined,
      (err) => {
        console.error("[jobs] orphan recovery failed:", err);
      }
    );
  }
  return orphansRecoveredPromise;
}

/** Mark any pending/running jobs as failed. Called once at module load
 *  via the lazy-init promise above. Exported for tests. */
export async function recoverOrphanedJobs(): Promise<number> {
  let count = 0;
  try {
    await fs.mkdir(jobsDir(), { recursive: true });
    const files = await fs.readdir(jobsDir());
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(jobsDir(), file), "utf-8");
        const job = JSON.parse(raw) as Job;
        if (job.status === "pending" || job.status === "running") {
          const updated: Job = {
            ...job,
            status: "failed",
            error:
              "Server restarted while this analysis was running. Re-submit to try again.",
            updatedAt: new Date().toISOString(),
          };
          await atomicWriteJson(jobPath(job.id), updated);
          count++;
        }
      } catch {
        // Skip corrupted job file — better than crashing on startup
      }
    }
  } catch {
    // jobs dir doesn't exist yet — nothing to recover
  }
  if (count > 0) {
    console.log(`[jobs] recovered ${count} orphaned job(s)`);
  }
  return count;
}

// ------------------- Test-only helpers -------------------

/** Reset the lazy orphan-recovery flag. Tests use this to control when
 *  recovery runs. Not exposed via the package's public surface — only
 *  imported by the test file. */
export function _resetOrphanRecoveryForTest(): void {
  orphansRecoveredPromise = null;
}

/** Test helper: list all job files in the storage dir. */
export async function _listJobsForTest(): Promise<Job[]> {
  try {
    const files = await fs.readdir(jobsDir());
    const out: Job[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(jobsDir(), file), "utf-8");
        out.push(JSON.parse(raw) as Job);
      } catch {
        // skip
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Re-export the patch helper for tests that want to drive job state
 *  directly (without going through processJob). */
export const _patchJobForTest = patchJob;

export type { JobStatus };
