// GET /api/sessions must never become a directory of other people's work.
//
// It used to return every non-private session on the instance to an
// unauthenticated caller — repo name, timestamps, session id, and `userId` —
// so a stranger could enumerate which repositories each account had analyzed
// and when. The intent was the "anyone with the URL can view a public
// analysis" rule, but a shareable link and a full directory are different
// promises and only the first was ever made.
//
// These tests pin the three properties that keep it that way: sign-in is
// required, you only ever see your own, and account identifiers never appear
// in the response. Sharing is deliberately NOT covered here — a public
// analysis stays readable by anyone holding its id; what this endpoint must
// not do is hand out ids nobody gave you.

import { describe, it, expect, beforeEach, vi } from "vitest";

const getSessionMock = vi.fn();
const listSessionsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } },
}));
vi.mock("@/lib/storage", () => ({
  listSessions: () => listSessionsMock(),
  deleteSession: vi.fn(),
}));
// Pulled in by the module's POST half; irrelevant here but must resolve.
vi.mock("@/lib/jobs", () => ({ createJob: vi.fn(), processJob: vi.fn() }));
vi.mock("@/lib/billing/gates", () => ({ getUserTier: vi.fn() }));

import { GET } from "@/app/api/sessions/route";

const ALICE = "user_alice";
const BOB = "user_bob";

const SESSIONS = [
  {
    id: "aaa",
    name: "alice public",
    repoUrl: "https://github.com/alice/app",
    repoFullName: "alice/app",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    snapshotCount: 1,
    userId: ALICE,
    ownerId: "browser-alice",
    private: false,
  },
  {
    id: "bbb",
    name: "bob public",
    repoUrl: "https://github.com/bob/api",
    repoFullName: "bob/api",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    snapshotCount: 2,
    userId: BOB,
    ownerId: "browser-bob",
    private: false,
  },
  {
    id: "ccc",
    name: "bob private",
    repoUrl: "https://github.com/bob/secret",
    repoFullName: "bob/secret",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    snapshotCount: 1,
    userId: BOB,
    ownerId: "browser-bob",
    private: true,
  },
];

function req() {
  return new Request("http://localhost/api/sessions");
}

beforeEach(() => {
  getSessionMock.mockReset();
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue(SESSIONS);
});

describe("GET /api/sessions", () => {
  it("refuses an unauthenticated caller instead of listing the instance", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.sessions).toBeUndefined();
  });

  it("returns only the caller's own analyses, public ones included", async () => {
    getSessionMock.mockResolvedValue({ user: { id: ALICE } });

    const res = await GET(req());
    const { sessions } = await res.json();

    expect(res.status).toBe(200);
    expect(sessions.map((s: { id: string }) => s.id)).toEqual(["aaa"]);
  });

  it("never leaks another account's public analysis", async () => {
    // Bob's public repo analysis is the exact thing that used to be listed to
    // everyone. Alice must not see it.
    getSessionMock.mockResolvedValue({ user: { id: ALICE } });

    const { sessions } = await (await GET(req())).json();

    const names = sessions.map((s: { repoFullName: string }) => s.repoFullName);
    expect(names).not.toContain("bob/api");
    expect(names).not.toContain("bob/secret");
  });

  it("strips account identifiers from every row", async () => {
    getSessionMock.mockResolvedValue({ user: { id: BOB } });

    const { sessions } = await (await GET(req())).json();

    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(Object.keys(s)).not.toContain("userId");
      expect(Object.keys(s)).not.toContain("ownerId");
    }
    // and still carries what a listing actually needs
    expect(sessions[0]).toMatchObject({ id: expect.any(String), repoFullName: expect.any(String) });
  });
});
