// The landing's demo cards read production session files at request time, and
// those files are enormous — the zod sweep is 55 MB, and the three together
// measured 165 ms / ~67 MB of JSON parse. The home page is force-dynamic, so
// without the memo every visitor pays that. These tests pin the two properties
// that keep it off the critical path (read once per TTL, share one read between
// concurrent callers) and the one that keeps the page up when the volume has no
// demo sessions on it — which is every laptop, and any deploy before the demos
// are seeded.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const getSession = vi.fn();

vi.mock("../storage", () => ({
  getSession: (id: string) => getSession(id),
}));

vi.mock("../demoSessions", () => ({
  DEMO_SESSIONS: [
    { label: "zod", repo: "colinhacks/zod", sessionId: "aaa" },
    { label: "flask", repo: "pallets/flask", sessionId: "bbb" },
    // Unconfigured: must be dropped, not rendered as a dead card.
    { label: "gin", repo: "gin-gonic/gin", sessionId: "" },
  ],
}));

vi.mock("../intelligence/headline", () => ({
  pickHeadline: (snap: { marker: string }) => ({
    primary: `finding for ${snap.marker}`,
  }),
}));

import {
  loadDemoHighlights,
  formatStars,
  _resetDemoHighlightsCache,
} from "../demoHighlights";

function sessionWith(marker: string, repo: Record<string, unknown>) {
  return { snapshots: [{ marker, repo }] };
}

beforeEach(() => {
  _resetDemoHighlightsCache();
  getSession.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadDemoHighlights", () => {
  it("quotes the session's own headline and drops unconfigured demos", async () => {
    getSession.mockImplementation(async (id: string) =>
      sessionWith(id, { language: "TypeScript", stars: 42700 }),
    );

    const out = await loadDemoHighlights();

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      repo: "colinhacks/zod",
      sessionId: "aaa",
      language: "TypeScript",
      stars: 42700,
      finding: "finding for aaa",
    });
    expect(out.map((d) => d.sessionId)).not.toContain("");
  });

  it("reads once per TTL, not once per landing visit", async () => {
    getSession.mockImplementation(async (id: string) =>
      sessionWith(id, { language: "Go", stars: 1 }),
    );

    await loadDemoHighlights();
    await loadDemoHighlights();
    await loadDemoHighlights();

    // 2 configured demos, read on the first call only.
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent cold callers", async () => {
    let resolve: (v: unknown) => void = () => {};
    const gate = new Promise((r) => {
      resolve = r;
    });
    getSession.mockImplementation(async (id: string) => {
      await gate;
      return sessionWith(id, { language: "Python", stars: 2 });
    });

    // Five visitors hit a cold container at the same moment.
    const all = Promise.all([
      loadDemoHighlights(),
      loadDemoHighlights(),
      loadDemoHighlights(),
      loadDemoHighlights(),
      loadDemoHighlights(),
    ]);
    resolve(null);
    const results = await all;

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.length === 2)).toBe(true);
  });

  it("re-reads once the TTL has passed", async () => {
    vi.useFakeTimers();
    getSession.mockImplementation(async (id: string) =>
      sessionWith(id, { language: "Go", stars: 1 }),
    );

    await loadDemoHighlights();
    expect(getSession).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(16 * 60_000);
    await loadDemoHighlights();
    expect(getSession).toHaveBeenCalledTimes(4);
  });

  it("degrades to a linkable card when the session is missing", async () => {
    // Every laptop, and any deploy whose volume has not been seeded.
    getSession.mockResolvedValue(null);

    const out = await loadDemoHighlights();

    expect(out).toHaveLength(2);
    for (const d of out) {
      expect(d.sessionId).toBeTruthy(); // still links into the demo
      expect(d.finding).toBeNull(); // but invents nothing
      expect(d.language).toBeNull();
      expect(d.stars).toBeNull();
    }
  });

  it("never throws when a session file is unreadable", async () => {
    getSession.mockRejectedValue(new Error("EACCES"));

    await expect(loadDemoHighlights()).resolves.toHaveLength(2);
  });

  it("survives a session with no snapshots", async () => {
    getSession.mockResolvedValue({ snapshots: [] });

    const out = await loadDemoHighlights();
    expect(out.every((d) => d.finding === null)).toBe(true);
  });
});

describe("formatStars", () => {
  it("keeps small counts exact and compacts the rest", () => {
    expect(formatStars(0)).toBe("0");
    expect(formatStars(999)).toBe("999");
    expect(formatStars(1000)).toBe("1.0k");
    expect(formatStars(42700)).toBe("42.7k");
    expect(formatStars(71600)).toBe("71.6k");
    // Past 100k the decimal is noise at card size.
    expect(formatStars(128400)).toBe("128k");
  });
});
