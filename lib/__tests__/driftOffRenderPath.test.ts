// The drift report must not be computed on the session render path.
//
// It used to be. app/session/[id]/layout.tsx called getDriftReport, so all
// seventeen tabs paid for it on every navigation — and its only consumer was
// DriftCardModal, whose `open` starts false. Nobody was looking at the answer.
//
// The cost is not the JSON. computeDriftTrends compares the OLDEST and NEWEST
// measurable snapshots, and driftMetricsFor falls back to walking that
// snapshot's whole code graph (findDuplicateGroups + computeTestCoverage) when
// the persisted fingerprint is missing — which it is on 55 of the 57 snapshots
// on disk. Measured per page load: 2.1 ms on gin, 7.9 on zod, 8.5 on our own
// repo.
//
// The milliseconds are modest. The structural win is that sixteen of the
// seventeen routes stopped needing snapshots[0] at all, which is what a future
// split of the session file depends on. The Overview still needs it, because it
// genuinely renders a drift panel — that exception is asserted here so it stays
// a known one rather than a rediscovered surprise.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

const layout = read("app", "session", "[id]", "layout.tsx");
const modal = read("components", "DriftCardModal.tsx");
const toolbar = read("components", "SessionToolbar.tsx");

describe("the layout does not compute drift", () => {
  it("never calls getDriftReport", () => {
    expect(layout).not.toMatch(/getDriftReport/);
  });

  it("does not hand a report to the toolbar", () => {
    expect(layout).not.toMatch(/driftReport=/);
    expect(toolbar).not.toMatch(/driftReport/);
  });
});

describe("the modal fetches its own report", () => {
  it("calls the drift endpoint when it opens", () => {
    expect(modal).toMatch(/fetch\(`\/api\/sessions\/\$\{sessionId\}\/drift`/);
    // Guarded on `open` so a closed dialog costs nothing, which is the whole
    // point of moving it.
    expect(modal).toMatch(/if \(!open \|\| report\) return;/);
  });

  it("takes a session id instead of a report", () => {
    expect(modal).toMatch(/sessionId: string;/);
    expect(modal).not.toMatch(/^\s*report: DriftReport;/m);
  });

  it("distinguishes waiting from having no baseline", () => {
    // "Comparing sweeps…" is the fetch. The two-sweeps message is a real
    // answer. Collapsing them would tell a one-sweep session it is loading,
    // forever.
    expect(modal).toContain("Comparing sweeps");
    expect(modal).toContain("Drift needs at least two sweeps");
  });
});

describe("the endpoint is gated like the pages", () => {
  const routePath = ["app", "api", "sessions", "[id]", "drift", "route.ts"];

  it("exists", () => {
    expect(existsSync(path.join(process.cwd(), ...routePath))).toBe(true);
  });

  it("answers a missing session exactly as a forbidden one", () => {
    // Otherwise it becomes an existence oracle for private analyses — the same
    // hole the badge endpoint had.
    const route = read(...routePath);
    expect(route).toMatch(/requireSessionReadAccessFromRequest/);
    expect(route).toMatch(/status: 404/);
    expect(route).not.toMatch(/status: 40[13]/);
  });
});

describe("the Overview keeps its drift panel", () => {
  it("is the one route that still needs the oldest snapshot", () => {
    // Not an oversight: it renders the panel. Recorded so a later split of the
    // session file knows exactly which surface still reads history.
    const overview = read("app", "session", "[id]", "page.tsx");
    expect(overview).toMatch(/getDriftReport/);
  });
});
