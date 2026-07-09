// Route-level coverage for GET /session/[id]/sbom — the Pro gate, the private-
// repo read gate, and the no-components 409 (the pure generator is covered in
// sbom.test.ts). Mirrors badgeRoute.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../types";

vi.mock("../storage", () => ({ getSession: vi.fn() }));
vi.mock("../ownership", () => ({ requireSessionReadAccess: vi.fn() }));
vi.mock("../authSession", () => ({ getAuthSession: vi.fn() }));
vi.mock("../billing/gates", () => ({ canAccess: vi.fn() }));
vi.mock("../demoSessions", () => ({ isDemoSession: vi.fn() }));

import { GET } from "@/app/session/[id]/sbom/route";
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

function session(withComponents = true): Session {
  return {
    id: "s1",
    snapshots: [
      {
        repo: { fullName: "octocat/repo" },
        fetchedAt: "2026-07-08T12:00:00.000Z",
        analyzedRef: "abc",
        dependencyHealths: [
          {
            ecosystem: "npm",
            total: 1,
            outdated: [],
            vulnerable: [],
            deprecated: [],
            analyzedAt: "2026-07-08T12:00:00.000Z",
            components: withComponents
              ? [{ name: "lodash", version: "4.17.21", scope: "runtime" }]
              : [],
          },
        ],
      },
    ],
  } as unknown as Session;
}

async function fetchSbom(format = "cyclonedx") {
  const res = await GET(
    new Request(`http://localhost/session/s1/sbom?format=${format}`),
    { params: Promise.resolve({ id: "s1" }) },
  );
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default happy path: session exists, readable, entitled via Pro.
  mockGetSession.mockResolvedValue(session(true));
  mockReadAccess.mockResolvedValue(true);
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockCanAccess.mockResolvedValue(true);
  mockIsDemo.mockReturnValue(false);
});

describe("GET /session/[id]/sbom", () => {
  it("404s a missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await fetchSbom()).status).toBe(404);
  });

  it("404s a private-repo session for a non-owner (never leaks the SBOM)", async () => {
    mockReadAccess.mockResolvedValue(false);
    expect((await fetchSbom()).status).toBe(404);
  });

  it("402s a non-entitled (non-Pro, non-demo) caller", async () => {
    mockCanAccess.mockResolvedValue(false);
    expect((await fetchSbom()).status).toBe(402);
  });

  it("402s an anonymous caller on a non-demo session", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await fetchSbom()).status).toBe(402);
  });

  it("409s when the snapshot has no captured components", async () => {
    mockGetSession.mockResolvedValue(session(false));
    expect((await fetchSbom()).status).toBe(409);
  });

  it("streams a CycloneDX attachment for an entitled caller", async () => {
    const res = await fetchSbom("cyclonedx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("cyclonedx");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(JSON.parse(await res.text()).bomFormat).toBe("CycloneDX");
  });

  it("streams SPDX and lets a demo session bypass the paywall", async () => {
    mockCanAccess.mockResolvedValue(false); // not entitled by tier…
    mockIsDemo.mockReturnValue(true); // …but it's a demo session
    const res = await fetchSbom("spdx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spdx");
    expect(JSON.parse(await res.text()).spdxVersion).toBe("SPDX-2.3");
  });
});
