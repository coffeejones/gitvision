// Tests for the v0.25 job-queue primitives:
//   - createJob / getJob / deleteJob (filesystem CRUD)
//   - atomic write pattern (no half-written state visible to readers)
//   - processJob idempotency (won't double-run a job already in
//     running/done/failed state)
//   - recoverOrphanedJobs (server-restart recovery sweep)
//
// We DON'T exercise the full processJob path here — that would require
// hitting GitHub for a real analyzeRepo call. Instead we set up jobs in
// the desired state directly and verify state transitions are correct.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Set the data dir env var BEFORE importing the jobs module so the lazy
// jobsDir() helper picks it up. Each test resets the dir to a clean slate.
const TMP_ROOT = path.join(
  os.tmpdir(),
  `repobaron-jobs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);
process.env.REPOBARON_DATA_DIR = TMP_ROOT;

import {
  createJob,
  getJob,
  deleteJob,
  processJob,
  recoverOrphanedJobs,
  _resetOrphanRecoveryForTest,
  _listJobsForTest,
  _patchJobForTest,
} from "../jobs";

beforeEach(async () => {
  // Clean state for each test: wipe the jobs dir + reset the lazy
  // orphan-recovery flag so the next call re-runs recovery if it wants to.
  await fs.rm(path.join(TMP_ROOT, "jobs"), { recursive: true, force: true });
  _resetOrphanRecoveryForTest();
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe("createJob + getJob", () => {
  it("writes a job file with status=pending and a unique id", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "https://github.com/owner/repo",
      subdir: null,
    });
    expect(job.status).toBe("pending");
    expect(job.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(job.input.kind).toBe("create-session");
  });

  it("getJob returns the persisted record verbatim", async () => {
    const created = await createJob({
      kind: "create-session",
      repoUrl: "https://github.com/owner/repo",
      subdir: "src/cmd",
      sessionName: "Custom name",
    });
    const fetched = await getJob(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.input).toEqual({
      kind: "create-session",
      repoUrl: "https://github.com/owner/repo",
      subdir: "src/cmd",
      sessionName: "Custom name",
    });
  });

  it("getJob returns null for a non-existent id", async () => {
    const fetched = await getJob("does-not-exist");
    expect(fetched).toBeNull();
  });

  it("createJob produces unique ids across rapid calls", async () => {
    const jobs = await Promise.all([
      createJob({ kind: "create-session", repoUrl: "x", subdir: null }),
      createJob({ kind: "create-session", repoUrl: "x", subdir: null }),
      createJob({ kind: "create-session", repoUrl: "x", subdir: null }),
    ]);
    const ids = jobs.map((j) => j.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("atomic writes", () => {
  it("readers never see a partial file even with concurrent writes", async () => {
    // We can't easily race writes against reads in a unit test, but we can
    // verify that at any moment after createJob resolves, getJob returns
    // valid JSON. The contract is enforced by the rename pattern: tmp
    // files are never readable as the canonical name.
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    // Patch a few times in succession; getJob between any two should always
    // succeed.
    await _patchJobForTest(job.id, { status: "running" });
    const a = await getJob(job.id);
    expect(a?.status).toBe("running");
    await _patchJobForTest(job.id, { status: "done", sessionId: "abc" });
    const b = await getJob(job.id);
    expect(b?.status).toBe("done");
    expect(b?.sessionId).toBe("abc");
  });

  it("does not leave .tmp files lying around after success", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, { status: "done" });
    const dir = await fs.readdir(path.join(TMP_ROOT, "jobs"));
    const tmps = dir.filter((f) => f.includes(".tmp."));
    expect(tmps).toEqual([]);
    expect(dir).toContain(`${job.id}.json`);
  });
});

describe("deleteJob", () => {
  it("removes the job file", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    expect(await deleteJob(job.id)).toBe(true);
    expect(await getJob(job.id)).toBeNull();
  });

  it("returns false when the job doesn't exist", async () => {
    expect(await deleteJob("ghost")).toBe(false);
  });
});

describe("processJob idempotency", () => {
  it("does not re-run a job that's already in 'running' state", async () => {
    // Set up: create a job, manually patch to running. Calling processJob
    // should return immediately without modifying status (no re-entry).
    const job = await createJob({
      kind: "create-session",
      repoUrl: "https://github.com/owner/repo",
      subdir: null,
    });
    await _patchJobForTest(job.id, { status: "running" });
    await processJob(job.id);
    const after = await getJob(job.id);
    // Still 'running' because processJob bailed out before touching it.
    // (If processJob HAD re-entered, it would have failed at the
    // analyzeRepo step, leaving status=failed.)
    expect(after?.status).toBe("running");
  });

  it("does not re-run a job already in 'done' state", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, {
      status: "done",
      sessionId: "session-abc",
    });
    await processJob(job.id);
    const after = await getJob(job.id);
    expect(after?.status).toBe("done");
    expect(after?.sessionId).toBe("session-abc");
  });

  it("does not re-run a job already in 'failed' state", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, {
      status: "failed",
      error: "earlier failure",
    });
    await processJob(job.id);
    const after = await getJob(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("earlier failure");
  });

  it("processJob on a non-existent id is a no-op (no throw)", async () => {
    await expect(processJob("ghost")).resolves.toBeUndefined();
  });
});

describe("recoverOrphanedJobs", () => {
  it("marks pending jobs as failed", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    expect(job.status).toBe("pending");
    const count = await recoverOrphanedJobs();
    expect(count).toBe(1);
    const after = await getJob(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toMatch(/server restarted/i);
  });

  it("marks running jobs as failed", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, { status: "running" });
    const count = await recoverOrphanedJobs();
    expect(count).toBe(1);
    const after = await getJob(job.id);
    expect(after?.status).toBe("failed");
  });

  it("leaves done jobs untouched", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, {
      status: "done",
      sessionId: "session-abc",
    });
    const count = await recoverOrphanedJobs();
    expect(count).toBe(0);
    const after = await getJob(job.id);
    expect(after?.status).toBe("done");
    expect(after?.sessionId).toBe("session-abc");
  });

  it("leaves already-failed jobs untouched", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    await _patchJobForTest(job.id, { status: "failed", error: "old error" });
    const count = await recoverOrphanedJobs();
    expect(count).toBe(0);
    const after = await getJob(job.id);
    expect(after?.error).toBe("old error");
  });

  it("returns 0 when the jobs dir doesn't exist yet", async () => {
    // beforeEach already wiped it. Confirm recovery is safe on cold start.
    const count = await recoverOrphanedJobs();
    expect(count).toBe(0);
  });

  it("skips corrupted job files without crashing", async () => {
    // Write a malformed job file. recoverOrphanedJobs should ignore it
    // and continue processing other valid files.
    const dir = path.join(TMP_ROOT, "jobs");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "garbage.json"), "{ not json", "utf-8");
    const valid = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    const count = await recoverOrphanedJobs();
    expect(count).toBe(1); // valid one was rescued; garbage was skipped
    const after = await getJob(valid.id);
    expect(after?.status).toBe("failed");
  });

  it("handles a mixed state: some pending, some running, some done", async () => {
    const a = await createJob({ kind: "create-session", repoUrl: "x", subdir: null });
    const b = await createJob({ kind: "create-session", repoUrl: "x", subdir: null });
    const c = await createJob({ kind: "create-session", repoUrl: "x", subdir: null });
    await _patchJobForTest(b.id, { status: "running" });
    await _patchJobForTest(c.id, {
      status: "done",
      sessionId: "session-abc",
    });
    const count = await recoverOrphanedJobs();
    expect(count).toBe(2); // a + b, not c
    expect((await getJob(a.id))?.status).toBe("failed");
    expect((await getJob(b.id))?.status).toBe("failed");
    expect((await getJob(c.id))?.status).toBe("done");
  });
});

describe("listJobsForTest helper sanity-check", () => {
  it("reflects what's actually on disk", async () => {
    const job = await createJob({
      kind: "create-session",
      repoUrl: "x",
      subdir: null,
    });
    const list = await _listJobsForTest();
    expect(list.map((j) => j.id)).toContain(job.id);
  });
});
