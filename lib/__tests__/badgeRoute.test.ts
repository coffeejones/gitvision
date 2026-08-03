// Route-level coverage for GET /badge/[id] — the security-critical private-leak
// guard and the trend-arrow logic (the pure SVG builders are covered in
// badge.test.ts). Also locks in isSessionPrivate, the guard the route relies on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../types";
import { isSessionPrivate } from "../ownership";

vi.mock("../storage", () => ({ getSession: vi.fn() }));
// computeVerdict only needs to yield {score, grade}; read them off the fake snap.
// verdictFor is the real thing's shape: prefer a verdict frozen at analysis
// time, else compute. The route reads the PREVIOUS snapshot through it, so a
// stub that always computed would hide whether the freeze is honoured.
vi.mock("../intelligence/verdict", () => {
  const computeVerdict = (snap: { score: number; grade: string }) => ({
    score: snap.score,
    grade: snap.grade,
  });
  return {
    computeVerdict,
    verdictFor: (snap: { verdict?: { score: number; grade: string }; score: number; grade: string }) =>
      snap.verdict ?? computeVerdict(snap),
  };
});

import { GET } from "@/app/badge/[id]/route";
import { getSession } from "../storage";

const mockGetSession = vi.mocked(getSession);

function snap(over: Partial<{ private: boolean; score: number; grade: string }> = {}) {
  const { private: priv = false, score = 80, grade = "B+" } = over;
  return { repo: { private: priv }, score, grade };
}

function session(snapshots: unknown[]): Session {
  return { id: "s1", snapshots } as unknown as Session;
}

async function fetchBadge(id = "s1") {
  const res = await GET(new Request(`http://localhost/badge/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: await res.text() };
}

beforeEach(() => mockGetSession.mockReset());

describe("GET /badge/[id]", () => {
  it("NEVER leaks a private repo's grade — returns the neutral badge", async () => {
    mockGetSession.mockResolvedValue(session([snap({ private: true, grade: "A" })]));
    const { status, body } = await fetchBadge();
    expect(status).toBe(200);
    expect(body).toContain("private");
    expect(body).not.toContain(">A<"); // the grade must not appear
    expect(body).not.toContain("#2ea043"); // nor its ramp colour
  });

  // This route has no auth — GitHub's image proxy strips cookies — so the only
  // way it can avoid confirming that an id is real is to answer a private
  // analysis and a nonexistent one identically. It used to 404 the miss and
  // return 200 "private" for the hit, which told anyone holding an id exactly
  // what they wanted to know, while every other route in the product returns
  // 404 precisely to avoid saying it.
  it("answers a missing session identically to a private one", async () => {
    mockGetSession.mockResolvedValue(session([snap({ private: true, grade: "A" })]));
    const hit = await fetchBadge();

    mockGetSession.mockResolvedValue(null);
    const miss = await fetchBadge();

    expect(miss.status).toBe(hit.status);
    expect(miss.body).toBe(hit.body);
  });

  it("shows the grade with no arrow for a single-snapshot session", async () => {
    mockGetSession.mockResolvedValue(session([snap({ grade: "B+" })]));
    const { status, body } = await fetchBadge();
    expect(status).toBe(200);
    expect(body).toContain("B+");
    expect(/[↗↘→]/.test(body)).toBe(false);
  });

  it("shows a down arrow when the score regressed since the previous sweep", async () => {
    mockGetSession.mockResolvedValue(
      session([snap({ score: 90, grade: "A-" }), snap({ score: 70, grade: "B-" })]),
    );
    const { body } = await fetchBadge();
    expect(body).toContain("B- ↘");
  });

  it("shows an up arrow when the score improved", async () => {
    mockGetSession.mockResolvedValue(
      session([snap({ score: 70, grade: "B-" }), snap({ score: 90, grade: "A-" })]),
    );
    const { body } = await fetchBadge();
    expect(body).toContain("A- ↗");
  });

  it("trends against the frozen verdict, not a fresh recompute", async () => {
    // The whole point of the freeze. The older snapshot's live numbers say the
    // score held; the verdict it recorded at analysis time says it was 90. The
    // badge must believe the recorded one, or a detector change alone moves an
    // arrow on a repo where nothing happened.
    mockGetSession.mockResolvedValue(
      session([
        { ...snap({ score: 80, grade: "B+" }), verdict: { score: 90, grade: "A-" } },
        snap({ score: 80, grade: "B+" }),
      ]),
    );
    const { body } = await fetchBadge();
    expect(body).toContain("B+ ↘");
  });

  it("shows a flat arrow when the score held", async () => {
    mockGetSession.mockResolvedValue(
      session([snap({ score: 80, grade: "B+" }), snap({ score: 80, grade: "B+" })]),
    );
    const { body } = await fetchBadge();
    expect(body).toContain("B+ →");
  });

  it("returns a pending badge for a session with no snapshots", async () => {
    mockGetSession.mockResolvedValue(session([]));
    const { status, body } = await fetchBadge();
    expect(status).toBe(200);
    expect(body).toContain("pending");
  });
});

describe("isSessionPrivate (the badge leak guard)", () => {
  it("is true only when the latest snapshot's repo is private", () => {
    expect(isSessionPrivate(session([snap({ private: true })]))).toBe(true);
    expect(isSessionPrivate(session([snap({ private: false })]))).toBe(false);
  });

  it("defaults to public for legacy snapshots missing the private field", () => {
    expect(isSessionPrivate(session([{ repo: {} }]))).toBe(false);
    expect(isSessionPrivate(session([]))).toBe(false);
  });

  it("reads the LATEST snapshot, not an earlier one", () => {
    expect(
      isSessionPrivate(session([snap({ private: false }), snap({ private: true })])),
    ).toBe(true);
  });
});
