// Route-level coverage for GET /session/[id]/evidence — the Pro gate, the
// private-repo read gate, and that it streams a real zip (the pack contents are
// covered in evidencePack.test.ts). Mirrors sbomRoute.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../types";

vi.mock("../storage", () => ({ getSession: vi.fn() }));
vi.mock("../ownership", () => ({ requireSessionReadAccess: vi.fn() }));
vi.mock("../authSession", () => ({ getAuthSession: vi.fn() }));
vi.mock("../billing/gates", () => ({ canAccess: vi.fn() }));
vi.mock("../demoSessions", () => ({ isDemoSession: vi.fn() }));

import { GET } from "@/app/session/[id]/evidence/route";
import { getSession } from "../storage";
import { requireSessionReadAccess } from "../ownership";
import { getAuthSession } from "../authSession";
import { canAccess } from "../billing/gates";
import { isDemoSession } from "../demoSessions";

const mockGetSession = vi.mocked(getSession);
const mockReadAccess = vi.mocked(requireSessionReadAccess);
const mockAuth = vi.mocked(getAuthSession);
const mockCanAccess = vi.mocked(canAccess);
const mockIsDemo = vi.mocked(isDemoSession);

function session(hasSnapshot = true): Session {
  const snap = {
    repo: { fullName: "octocat/repo" },
    fetchedAt: "2026-07-08T00:00:00.000Z",
    analyzedRef: "abc",
    contributors: [],
    languages: {},
    recentCommits: [],
    hotspots: [],
    coChange: [],
    commitActivity: [],
    dependencyHealths: [],
  };
  return {
    id: "s1",
    snapshots: hasSnapshot ? [snap] : [],
  } as unknown as Session;
}

async function fetchEvidence() {
  return GET(new Request("http://localhost/session/s1/evidence"), {
    params: Promise.resolve({ id: "s1" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSession.mockResolvedValue(session(true));
  mockReadAccess.mockResolvedValue(true);
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockCanAccess.mockResolvedValue(true);
  mockIsDemo.mockReturnValue(false);
});

describe("GET /session/[id]/evidence", () => {
  it("404s a missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await fetchEvidence()).status).toBe(404);
  });

  it("404s a private-repo session for a non-owner", async () => {
    mockReadAccess.mockResolvedValue(false);
    expect((await fetchEvidence()).status).toBe(404);
  });

  it("402s a non-entitled (non-Pro, non-demo) caller", async () => {
    mockCanAccess.mockResolvedValue(false);
    expect((await fetchEvidence()).status).toBe(402);
  });

  it("409s a session with no snapshot", async () => {
    mockGetSession.mockResolvedValue(session(false));
    expect((await fetchEvidence()).status).toBe(409);
  });

  it("streams a zip attachment for an entitled caller", async () => {
    const res = await fetchEvidence();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");
    // real zip: the local-file-header magic bytes are "PK\x03\x04"
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("lets a demo session bypass the paywall", async () => {
    mockCanAccess.mockResolvedValue(false);
    mockIsDemo.mockReturnValue(true);
    expect((await fetchEvidence()).status).toBe(200);
  });
});
