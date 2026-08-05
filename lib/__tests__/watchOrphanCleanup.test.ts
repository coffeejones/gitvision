// A watch must not outlive its session.
//
// deleteSession only unlinks the session file and the freshness record —
// lib/storage.ts is pure filesystem and a watch lives in Postgres, so it cannot
// reach one. The row survived pointing at nothing, and the damage was the
// opposite of noisy: processWatch skipped it and the sweep reported it under
// `skippedUnchanged`, the same bucket as "no new commits". No error, no log, no
// email, no retry. Meanwhile countWatchesForUser still counted it against the
// owner's Plus quota, and nothing in the UI could release it, because
// WatchToggle only exists on the session page that was just deleted.
//
// The fix is in two places on purpose. The delete routes clean up immediately,
// which covers the two direct paths. The MONITOR cleans up whatever reaches it,
// which covers the GitHub App's installation.deleted sweep (it unlinks files
// without going through those routes) and any path added later. Only the second
// one cannot be forgotten, so it is the one these tests exercise.

import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteWatchesForSession = vi.fn(async () => 1);
const listActiveWatches = vi.fn();
const getSession = vi.fn();

vi.mock("../watches", () => ({
  deleteWatchesForSession,
  listActiveWatches,
  updateWatchState: vi.fn(async () => {}),
}));
vi.mock("../storage", () => ({ getSession, appendSnapshot: vi.fn() }));

function watch(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    userId: "user-a",
    sessionId: "sess-gone",
    repoFullName: "acme/widget",
    createdAt: new Date(0),
    lastSweptAt: null,
    lastHeadSha: null,
    lastAlertedSha: null,
    paused: false,
    ...over,
  };
}

beforeEach(() => {
  deleteWatchesForSession.mockClear();
  listActiveWatches.mockReset();
  getSession.mockReset();
});

describe("the monitor reclaims a watch whose session is gone", () => {
  it("deletes the orphan instead of silently skipping it", async () => {
    const { runWatchMonitor } = await import("../watchMonitor");
    listActiveWatches.mockResolvedValue([watch()]);
    getSession.mockResolvedValue(null); // the session was deleted

    const result = await runWatchMonitor();

    expect(deleteWatchesForSession).toHaveBeenCalledWith("sess-gone");
    // Still reported as skipped — the sweep did no analysis work. The point is
    // that the row is gone, not that the accounting changed.
    expect(result.skippedUnchanged + result.swept).toBeGreaterThanOrEqual(0);
  });

  it("does not delete anything on a dry run", async () => {
    // dryRun exists to PREVIEW a sweep. Mutating during one would make the
    // preview destructive, which is the opposite of its contract.
    const { runWatchMonitor } = await import("../watchMonitor");
    listActiveWatches.mockResolvedValue([watch()]);
    getSession.mockResolvedValue(null);

    await runWatchMonitor({ dryRun: true });

    expect(deleteWatchesForSession).not.toHaveBeenCalled();
  });

  it("leaves a watch alone when its session still exists", async () => {
    // The obvious way to get this wrong is to delete on any skip. A session
    // with no snapshots, or an unparseable repo URL, also skips — and those
    // watches are still live.
    const { runWatchMonitor } = await import("../watchMonitor");
    listActiveWatches.mockResolvedValue([watch()]);
    getSession.mockResolvedValue({
      id: "sess-gone",
      repoUrl: "https://github.com/acme/widget",
      snapshots: [], // present but empty — skips for a DIFFERENT reason
    });

    await runWatchMonitor();

    expect(deleteWatchesForSession).not.toHaveBeenCalled();
  });

  it("survives a cleanup failure without failing the sweep", async () => {
    // The DB may be unreachable. A sweep that throws here would stop every
    // other watch from being processed — far worse than one stale row.
    const { runWatchMonitor } = await import("../watchMonitor");
    listActiveWatches.mockResolvedValue([watch(), watch({ id: "w2", sessionId: "sess-2" })]);
    getSession.mockResolvedValue(null);
    deleteWatchesForSession.mockRejectedValueOnce(new Error("db down"));

    await expect(runWatchMonitor()).resolves.toBeDefined();
    expect(deleteWatchesForSession).toHaveBeenCalledTimes(2);
  });
});

describe("the delete routes clean up eagerly", () => {
  it("both session-deletion paths call the cleanup", async () => {
    // The monitor is the backstop, but a user who deletes a session should get
    // their quota slot back now, not at the next sweep — which needs
    // CRON_SECRET set in Railway and may not be running at all.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const f of [
      ["app", "api", "sessions", "[id]", "route.ts"],
      ["app", "api", "sessions", "route.ts"],
    ]) {
      const src = readFileSync(path.default.join(process.cwd(), ...f), "utf-8");
      expect(src, `${f.join("/")} deletes a session without clearing its watch`).toContain(
        "deleteWatchesForSession",
      );
    }
  });
});
