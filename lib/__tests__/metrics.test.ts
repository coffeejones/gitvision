// Tests for the pure metrics aggregator. Synthetic users + sessions with a
// fixed `nowMs` so the weekly windows + day buckets are deterministic.

import { describe, it, expect } from "vitest";
import { aggregateMetrics } from "../metrics";

const NOW = Date.UTC(2026, 5, 17, 12, 0, 0); // fixed "now"
const D = 24 * 60 * 60 * 1000;

const users = [
  { createdAtMs: NOW - 1 * D, tier: "open-case" }, // this week, Free
  { createdAtMs: NOW - 3 * D, tier: "standing-docket" }, // this week, Plus (paid)
  { createdAtMs: NOW - 9 * D, tier: "full-bench" }, // prev week, Pro (paid)
  { createdAtMs: NOW - 40 * D, tier: "open-case" }, // old, Free
  { createdAtMs: NOW - 60 * D, tier: "scout" }, // legacy free tier — must NOT count as paid
];

const sessions = [
  { createdAtMs: NOW - 1 * D, repoFullName: "facebook/react", snapshotCount: 3 },
  { createdAtMs: NOW - 2 * D, repoFullName: "facebook/react", snapshotCount: 1 },
  { createdAtMs: NOW - 10 * D, repoFullName: "colinhacks/zod", snapshotCount: 2 },
  { createdAtMs: NOW - 50 * D, repoFullName: "vercel/next.js", snapshotCount: 1 },
];

describe("aggregateMetrics", () => {
  const m = aggregateMetrics(users, sessions, NOW);

  it("counts accounts: total, paid, tier breakdown, weekly windows", () => {
    expect(m.accounts.total).toBe(5);
    expect(m.accounts.paid).toBe(2); // Plus + Pro only — legacy "scout" stays Free
    expect(m.accounts.byTier).toEqual({ Free: 3, Plus: 1, Pro: 1 }); // 2 open-case + 1 scout

    expect(m.accounts.thisWeek).toBe(2); // -1d, -3d
    expect(m.accounts.prevWeek).toBe(1); // -9d
  });

  it("counts analyses: total, unique repos, refreshes, weekly windows", () => {
    expect(m.analyses.total).toBe(4);
    expect(m.analyses.uniqueRepos).toBe(3); // react, zod, next.js
    expect(m.analyses.refreshes).toBe(3); // (3-1)+(1-1)+(2-1)+(1-1)
    expect(m.analyses.thisWeek).toBe(2); // -1d, -2d
    expect(m.analyses.prevWeek).toBe(1); // -10d
  });

  it("ranks top repos by count, tie-broken by name", () => {
    expect(m.topRepos[0]).toEqual({ repo: "facebook/react", count: 2 });
    expect(m.topRepos[1].repo).toBe("colinhacks/zod"); // tie at 1, name-sorted
    expect(m.topRepos).toHaveLength(3);
  });

  it("emits 30 zero-filled day buckets, oldest first, summing in-window items", () => {
    expect(m.signupsByDay).toHaveLength(30);
    expect(m.analysesByDay).toHaveLength(30);
    expect(m.signupsByDay[0].day < m.signupsByDay[29].day).toBe(true); // oldest first
    // 3 signups fall inside the last 30 days (the -40d one is excluded).
    expect(m.signupsByDay.reduce((s, d) => s + d.count, 0)).toBe(3);
    // 3 analyses inside 30 days (the -50d one is excluded).
    expect(m.analysesByDay.reduce((s, d) => s + d.count, 0)).toBe(3);
  });

  it("never leaks PII by default — base output is counts only", () => {
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/@/); // no emails
    expect(m.detail).toBeUndefined();
  });

  it("emits last-activity timestamps in the base output", () => {
    expect(m.lastSignupAt).toBe(new Date(NOW - 1 * D).toISOString()); // newest signup -1d
    expect(m.lastAnalysisAt).toBe(new Date(NOW - 1 * D).toISOString()); // newest analysis -1d
  });
});

describe("aggregateMetrics — detail mode", () => {
  const withEmail = [
    { createdAtMs: NOW - 1 * D, tier: "open-case", email: "newest@example.com" },
    { createdAtMs: NOW - 9 * D, tier: "full-bench", email: "older@example.com" },
  ];

  it("adds recent accounts (email, newest-first) + per-repo dates when requested", () => {
    const d = aggregateMetrics(withEmail, sessions, NOW, { detail: true });
    expect(d.detail).toBeDefined();
    expect(d.detail!.accounts[0].email).toBe("newest@example.com");
    expect(d.detail!.accounts).toHaveLength(2);
    const react = d.detail!.repos.find((r) => r.repo === "facebook/react");
    expect(react?.count).toBe(2);
    expect(react?.lastAnalyzed).toBe(new Date(NOW - 1 * D).toISOString());
  });

  it("stays PII-free without the detail flag", () => {
    const base = aggregateMetrics(withEmail, sessions, NOW);
    expect(base.detail).toBeUndefined();
    expect(JSON.stringify(base)).not.toMatch(/@/);
  });
});

describe("aggregateMetrics — faultline (injected engine timing)", () => {
  const faultline = {
    count: 42,
    shed: 3,
    p50Ms: 120,
    p95Ms: 340,
    maxMs: 900,
    windowSize: 42,
    inFlight: 1,
    startedAt: "2026-06-17T00:00:00.000Z",
  };

  it("passes the injected faultline timing through unchanged", () => {
    const m = aggregateMetrics(users, sessions, NOW, {}, faultline);
    expect(m.faultline).toEqual(faultline);
  });

  it("omits faultline for pure callers that don't inject it", () => {
    const m = aggregateMetrics(users, sessions, NOW);
    expect(m.faultline).toBeUndefined();
  });
});

describe("aggregateMetrics — activation (injected wiring status)", () => {
  const activation = {
    receiptSecret: true,
    cronSecret: false,
    githubApp: true,
    aiExplainer: false,
    watchLastRun: "2026-07-23T08:00:00.000Z",
  };

  it("passes the injected activation status through unchanged", () => {
    const m = aggregateMetrics(users, sessions, NOW, {}, undefined, activation);
    expect(m.activation).toEqual(activation);
  });

  it("omits activation for pure callers that don't inject it", () => {
    const m = aggregateMetrics(users, sessions, NOW);
    expect(m.activation).toBeUndefined();
  });
});
