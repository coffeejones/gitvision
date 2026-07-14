// Route-level coverage for GET /api/sessions/[id]/source — the gate STACK and
// its order (rate limit → exists → read access → free-phase auth → analyzed-path
// → fetch), plus the integrity flag. The fetch/decode logic itself is covered in
// sourceView.test.ts; here makeOctokit is faked so the real fetchFileSource +
// isAligned run against controlled Contents payloads.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../types";
import { djb2 } from "../codeAnalysis/fileUniverse";

vi.mock("../storage", () => ({ getSession: vi.fn() }));
vi.mock("../ownership", () => ({ requireSessionReadAccess: vi.fn() }));
vi.mock("../authSession", () => ({ getAuthSession: vi.fn() }));
vi.mock("../demoSessions", () => ({ isDemoSession: vi.fn() }));
vi.mock("../githubUserToken", () => ({ getGithubTokenForUser: vi.fn() }));
vi.mock("../github", () => ({ makeOctokit: vi.fn() }));

import { GET } from "@/app/api/sessions/[id]/source/route";
import { getSession } from "../storage";
import { requireSessionReadAccess } from "../ownership";
import { getAuthSession } from "../authSession";
import { isDemoSession } from "../demoSessions";
import { getGithubTokenForUser } from "../githubUserToken";
import { makeOctokit } from "../github";

const mockGetSession = vi.mocked(getSession);
const mockReadAccess = vi.mocked(requireSessionReadAccess);
const mockAuth = vi.mocked(getAuthSession);
const mockIsDemo = vi.mocked(isDemoSession);
const mockGetToken = vi.mocked(getGithubTokenForUser);
const mockMakeOctokit = vi.mocked(makeOctokit);

const SRC = "export const x = 1;\n";
const PATH = "src/a.ts";

function session(over?: { private?: boolean }): Session {
  return {
    id: "s1",
    snapshots: [
      {
        repo: {
          owner: "octocat",
          name: "repo",
          fullName: "octocat/repo",
          defaultBranch: "main",
          private: over?.private ?? false,
        },
        analyzedRef: "abc123",
        codeGraph: { contentHashes: { [PATH]: djb2(SRC) } },
      },
    ],
  } as unknown as Session;
}

/** Fake octokit whose getContent returns a base64 "file" for `content`. */
function octoWith(content: string) {
  const getContent = vi.fn(async () => ({
    data: {
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(content, "utf-8"),
      content: Buffer.from(content, "utf-8").toString("base64"),
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockMakeOctokit.mockReturnValue({ rest: { repos: { getContent } } } as any);
  return getContent;
}

function call(path = PATH, id = "s1") {
  return GET(
    new Request(`http://localhost/api/sessions/${id}/source?path=${encodeURIComponent(path)}`),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: session exists, readable, viewer signed in, not a demo, public repo.
  mockGetSession.mockResolvedValue(session());
  mockReadAccess.mockResolvedValue(true);
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockIsDemo.mockReturnValue(false);
});

describe("GET source — gate stack", () => {
  it("404s when the session doesn't exist", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("404s when read access is denied (private-repo, non-owner)", async () => {
    mockReadAccess.mockResolvedValue(false);
    expect((await call()).status).toBe(404);
  });

  it("401s (signIn) when not a demo and not signed in — before any path work", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await call("../../etc/passwd"); // even a bad path must not leak past auth
    expect(res.status).toBe(401);
    expect((await res.json()).signIn).toBe(true);
  });

  it("400s on an unsafe path", async () => {
    expect((await call("../../etc/passwd")).status).toBe(400);
  });

  it("404s on a path that wasn't analyzed (no fetch attempted)", async () => {
    const getContent = octoWith(SRC);
    expect((await call("src/not-analyzed.ts")).status).toBe(404);
    expect(getContent).not.toHaveBeenCalled();
  });
});

describe("GET source — fetch + integrity", () => {
  it("returns 200 aligned:true when the fetched bytes match the analyzed hash", async () => {
    octoWith(SRC);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ path: PATH, ref: "abc123", content: SRC, aligned: true, ext: "ts" });
  });

  it("returns aligned:false when the file drifted since analysis", async () => {
    octoWith("export const x = 2;\n"); // different content → different djb2
    const body = await (await call()).json();
    expect(body.aligned).toBe(false);
    expect(body.content).toBe("export const x = 2;\n"); // still returned
  });

  it("pins the fetch to analyzedRef", async () => {
    const getContent = octoWith(SRC);
    await call();
    expect(getContent).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "octocat", repo: "repo", path: PATH, ref: "abc123" }),
    );
  });

  it("uses the owner's token for a private repo", async () => {
    mockGetSession.mockResolvedValue(session({ private: true }));
    mockGetToken.mockResolvedValue("gho_ownertoken");
    octoWith(SRC);
    await call();
    expect(mockGetToken).toHaveBeenCalledWith("u1");
    expect(mockMakeOctokit).toHaveBeenCalledWith("gho_ownertoken");
  });

  it("403s (reconnect) when a private repo has no stored token", async () => {
    mockGetSession.mockResolvedValue(session({ private: true }));
    mockGetToken.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).reconnect).toBe(true);
  });
});
