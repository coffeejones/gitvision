// A verdict is frozen when a snapshot is stored, so comparisons stay honest.
//
// computeVerdict() reads a snapshot through TODAY's signal detectors. Run over
// an old snapshot it answers "what would we say about this data now" — not
// "what did we say". Four places asked it the wrong question, always on the
// older side of a diff:
//
//   lib/intelligence/cases.ts:89   the workspace home's movement line
//   lib/watchMonitor.ts:195        the regression email
//   app/badge/[id]/route.ts:61     the badge's trend arrow
//   lib/evidencePack/build.ts:117  a Pro custody artifact's whole history
//
// So a session where nothing happened could show "+1 critical", and Watch could
// email that a new critical finding had appeared when none had. The watch case
// is the worst: assessRegression treats criticalDelta > 0 as severity
// "critical", and the recipient has no way to tell a real regression from a
// detector that learned something.
//
// The freeze is deliberately one-sided. The LATEST snapshot is still read live
// wherever it is displayed — freezing it too would let /verdict disagree with
// /signals after any detector improvement, trading one inconsistency for
// another without fixing anything.

import { describe, it, expect } from "vitest";

import type { AnalysisSnapshot } from "../types";
import { computeVerdict, verdictFor } from "../intelligence/verdict";

/** The repo's standard snapshot fixture, matching signals.test.ts's factory.
 *
 *  Written out rather than thinned: computeVerdict runs the full detector sweep,
 *  and a snapshot missing `contributors` or `hotspots` throws inside
 *  extractHealthSignals rather than returning a low grade. (Storage catches that
 *  and stores no verdict, which is the designed fallback — but a test fixture
 *  that silently takes the catch path would assert nothing.) */
function bare(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-08-03T00:00:00.000Z",
    repo: {
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      description: "Test repo",
      stars: 3,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      defaultBranch: "main",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      pushedAt: "2026-08-01T00:00:00Z",
      language: "TypeScript",
      license: "MIT",
      homepage: null,
      topics: [],
      private: false,
    },
    contributors: [],
    languages: {},
    recentCommits: [],
    hotspots: [],
    coChange: [],
    commitActivity: [],
    hasReadme: true,
    ...over,
  } as unknown as AnalysisSnapshot;
}

describe("verdictFor", () => {
  it("prefers the verdict recorded at analysis time", () => {
    // The recorded verdict is deliberately nothing computeVerdict would produce
    // for this snapshot, so a fallback cannot pass by coincidence.
    const recorded = { ...computeVerdict(bare()), score: 3, grade: "F" };
    const snap = bare({ verdict: recorded });
    expect(verdictFor(snap)).toBe(recorded);
    expect(verdictFor(snap).grade).toBe("F");
  });

  it("computes when there is nothing recorded", () => {
    // Every snapshot written before the freeze existed takes this path, and it
    // must behave exactly as the code did before — no backfill, no surprise.
    const snap = bare();
    expect(snap.verdict).toBeUndefined();
    expect(verdictFor(snap)).toEqual(computeVerdict(snap));
  });

  it("does not backfill onto the snapshot it read", () => {
    // Stamping today's computation onto an old snapshot would assert something
    // that snapshot never said — worse than having no record at all.
    const snap = bare();
    verdictFor(snap);
    expect(snap.verdict).toBeUndefined();
  });
});

describe("the phantom delta it was written to kill", () => {
  it("pins the critical count, which is the number that actually moved", async () => {
    // The grade was never the problem. Across all 55 snapshots on disk the
    // outcome, score and department votes never phantom-moved; the high-severity
    // COUNT did — and diffVerdict flips `direction` to "regressed" on
    // criticalDelta > 0, which is what makes Watch send a "critical" email.
    //
    // So: a baseline that recorded one critical, whose live recount today says
    // something else. criticalCountFor must believe the record.
    const { criticalCountFor } = await import("../intelligence/verdict");
    const live = computeVerdict(bare()).criticalCount;
    const baseline = bare({ verdict: { ...computeVerdict(bare()), criticalCount: live + 1 } });

    expect(criticalCountFor(baseline)).toBe(live + 1);
    // Without the freeze this baseline would recount to `live`, and the diff
    // against an unchanged repo would read as one critical resolved.
    expect(computeVerdict(baseline).criticalCount).toBe(live);
  });

  it("counts the same thing the two retired copies counted", async () => {
    // watchMonitor.ts and cases.ts each had a private countCriticals doing
    // extractHealthSignals(snap).needsWork.filter(severity === "high").length.
    // Both are gone; this pins that the replacement is not subtly different.
    const { extractHealthSignals } = await import("../signals");
    const snap = bare();
    const byHand = extractHealthSignals(snap).needsWork.filter(
      (x) => x.severity === "high",
    ).length;
    expect(computeVerdict(snap).criticalCount).toBe(byHand);
  });

  it("leaves no private copy of the counter behind", async () => {
    // Two duplicates is how it stayed broken in two places at once.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const f of [["lib", "watchMonitor.ts"], ["lib", "intelligence", "cases.ts"]]) {
      const src = readFileSync(path.default.join(process.cwd(), ...f), "utf-8");
      expect(src, `${f.join("/")} still defines its own counter`).not.toContain(
        "function countCriticals",
      );
    }
  });
});

describe("the write path freezes exactly once", () => {
  it("stamps a verdict on a snapshot as it is stored", async () => {
    const { createSession, appendSnapshot, deleteSession } = await import("../storage");
    const created = await createSession({
      repoUrl: "https://github.com/acme/widget",
      name: "acme/widget",
      initialSnapshot: bare(),
    });
    try {
      expect(created.snapshots[0].verdict, "createSession did not freeze").toBeDefined();

      const appended = await appendSnapshot(created.id, bare({ fetchedAt: "2026-08-04T00:00:00.000Z" }));
      expect(appended!.snapshots[1].verdict, "appendSnapshot did not freeze").toBeDefined();
    } finally {
      await deleteSession(created.id);
    }
  });

  it("never re-freezes a snapshot that already carries one", async () => {
    // Re-persisting must not overwrite the record with a fresh computation —
    // that would quietly undo the guarantee on every refresh.
    const { createSession, deleteSession } = await import("../storage");
    const recorded = { ...computeVerdict(bare()), score: 7, grade: "F" };
    const created = await createSession({
      repoUrl: "https://github.com/acme/widget",
      name: "acme/widget",
      initialSnapshot: bare({ verdict: recorded }),
    });
    try {
      expect(created.snapshots[0].verdict).toEqual(recorded);
    } finally {
      await deleteSession(created.id);
    }
  });

  it("does not mutate the snapshot the caller handed in", async () => {
    // lib/watchMonitor.ts persists `newSnap` and then keeps using that same
    // object. Mutating it would make the freeze invisible in review and couple
    // the caller to storage's internals.
    const { createSession, deleteSession } = await import("../storage");
    const mine = bare();
    const created = await createSession({
      repoUrl: "https://github.com/acme/widget",
      name: "acme/widget",
      initialSnapshot: mine,
    });
    try {
      expect(mine.verdict, "storage mutated the caller's snapshot").toBeUndefined();
      expect(created.snapshots[0].verdict).toBeDefined();
    } finally {
      await deleteSession(created.id);
    }
  });
});

describe("no comparison site recomputes the older side", () => {
  it("reads the baseline, prev and history through verdictFor", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const read = (...p: string[]) =>
      readFileSync(path.default.join(process.cwd(), ...p), "utf-8");

    // Pinned by call, not by line: the point is WHICH argument is read live.
    // `latest`/`newSnap` are freshly analysed and deliberately still computed.
    const sites: [string, string[], string][] = [
      ["cases verdict", ["lib", "intelligence", "cases.ts"], "verdictFor(baseline)"],
      ["cases criticals", ["lib", "intelligence", "cases.ts"], "criticalCountFor(baseline)"],
      ["watch verdict", ["lib", "watchMonitor.ts"], "verdictFor(prev)"],
      ["watch criticals", ["lib", "watchMonitor.ts"], "criticalCountFor(prev)"],
      ["badge", ["app", "badge", "[id]", "route.ts"], "verdictFor(snaps[snaps.length - 2])"],
      ["evidence pack", ["lib", "evidencePack", "build.ts"], "verdictFor(s).grade"],
    ];
    for (const [name, file, call] of sites) {
      expect(read(...file), `${name} recomputes the older side`).toContain(call);
    }
  });
});
