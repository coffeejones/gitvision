// Route-level coverage for POST /api/sessions/[id]/source/explain — the gate
// STACK, plus the three AI-specific behaviours the source route doesn't have:
// a cache hit costs no budget + no fetch, the daily budget kill-switch, and a
// drift refusal. explainFunction is mocked (no real Anthropic call); the real
// signal reshape, fetch, integrity check, budget, and cache run.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Session } from "../types";
import { djb2 } from "../codeAnalysis/fileUniverse";

vi.mock("../storage", () => ({ getSession: vi.fn() }));
vi.mock("../ownership", () => ({ requireSessionReadAccess: vi.fn() }));
vi.mock("../authSession", () => ({ getAuthSession: vi.fn() }));
vi.mock("../githubUserToken", () => ({ getGithubTokenForUser: vi.fn() }));
vi.mock("../github", () => ({ makeOctokit: vi.fn() }));
// Keep the real reshape/slice; only stub the network-bound explain call.
vi.mock("../functionExplain", async (importActual) => {
  const actual = await importActual<typeof import("../functionExplain")>();
  return { ...actual, explainFunction: vi.fn() };
});

import { POST } from "@/app/api/sessions/[id]/source/explain/route";
import { getSession } from "../storage";
import { requireSessionReadAccess } from "../ownership";
import { getAuthSession } from "../authSession";
import { getGithubTokenForUser } from "../githubUserToken";
import { makeOctokit } from "../github";
import { explainFunction } from "../functionExplain";
import { _resetAiBudgetForTest } from "../aiBudget";
import { _resetExplainCacheForTest } from "../functionExplainCache";

const mockGetSession = vi.mocked(getSession);
const mockReadAccess = vi.mocked(requireSessionReadAccess);
const mockAuth = vi.mocked(getAuthSession);
const mockGetToken = vi.mocked(getGithubTokenForUser);
const mockMakeOctokit = vi.mocked(makeOctokit);
const mockExplain = vi.mocked(explainFunction);

const SRC = "export function x() {\n  return 1;\n}\n";
const PATH = "src/a.ts";

const EXPLANATION = {
  does: "returns 1",
  risk: "trivial and safe",
  suggestion: null,
  model: "claude-haiku-4-5",
  generatedAt: "2026-07-16T00:00:00.000Z",
  usage: { inputTokens: 1, outputTokens: 1 },
};

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
        hotspots: [],
        codeGraph: {
          contentHashes: { [PATH]: djb2(SRC) },
          functions: [
            { filePath: PATH, name: "x", startRow: 0, endRow: 2, complexity: 10 },
          ],
          imports: [],
          calls: [],
          fileComplexity: {},
          filesByExt: {},
          byPlugin: {},
          generatedAt: "2026-07-14T00:00:00.000Z",
        },
      },
    ],
  } as unknown as Session;
}

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

function call(bodyOver?: Record<string, unknown>, id = "s1") {
  return POST(
    new Request(`http://localhost/api/sessions/${id}/source/explain`, {
      method: "POST",
      body: JSON.stringify({ path: PATH, fn: "x", line: 1, ...bodyOver }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const origKey = process.env.ANTHROPIC_API_KEY;
const origBudget = process.env.AI_DAILY_BUDGET;

beforeEach(() => {
  vi.clearAllMocks();
  _resetAiBudgetForTest();
  _resetExplainCacheForTest();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AI_DAILY_BUDGET; // default limit 100
  mockGetSession.mockResolvedValue(session());
  mockReadAccess.mockResolvedValue(true);
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockExplain.mockResolvedValue(EXPLANATION);
});

afterAll(() => {
  if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = origKey;
  if (origBudget === undefined) delete process.env.AI_DAILY_BUDGET;
  else process.env.AI_DAILY_BUDGET = origBudget;
});

describe("POST explain — gate stack", () => {
  it("501s when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await call()).status).toBe(501);
  });

  it("404s when the session doesn't exist", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("404s when read access is denied", async () => {
    mockReadAccess.mockResolvedValue(false);
    expect((await call()).status).toBe(404);
  });

  it("401s (signIn) when not signed in — the explainer needs a free account even on a demo", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).signIn).toBe(true);
  });

  it("400s on an unsafe path", async () => {
    expect((await call({ path: "../../etc/passwd" })).status).toBe(400);
  });

  it("404s on a path that wasn't analyzed", async () => {
    expect((await call({ path: "src/not-analyzed.ts" })).status).toBe(404);
  });

  it("404s when no function starts at the given line", async () => {
    expect((await call({ line: 999 })).status).toBe(404);
  });
});

describe("POST explain — explain + ground", () => {
  it("200s with signals + explanation on the happy path, and caches it", async () => {
    octoWith(SRC);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.explanation).toMatchObject({ does: "returns 1" });
    expect(body.signals).toMatchObject({ path: PATH, name: "x", line: 1, complexity: 10 });
    expect(mockExplain).toHaveBeenCalledTimes(1);
  });

  it("pins the fetch to analyzedRef", async () => {
    const getContent = octoWith(SRC);
    await call();
    expect(getContent).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "octocat", repo: "repo", path: PATH, ref: "abc123" }),
    );
  });

  it("a second call hits the cache — no budget spend, no fetch, no AI call", async () => {
    const getContent = octoWith(SRC);
    await call();
    expect(mockExplain).toHaveBeenCalledTimes(1);
    mockExplain.mockClear();
    getContent.mockClear();

    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBe(true);
    expect(mockExplain).not.toHaveBeenCalled();
    expect(getContent).not.toHaveBeenCalled();
  });

  it("409s (drifted) when the fetched bytes don't match the analyzed hash", async () => {
    octoWith("export function x() {\n  return 2;\n}\n"); // different djb2
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).drifted).toBe(true);
    expect(mockExplain).not.toHaveBeenCalled();
  });

  it("503s when the daily AI budget is exhausted, without fetching", async () => {
    process.env.AI_DAILY_BUDGET = "0";
    _resetAiBudgetForTest();
    const getContent = octoWith(SRC);
    const res = await call();
    expect(res.status).toBe(503);
    expect(getContent).not.toHaveBeenCalled();
    expect(mockExplain).not.toHaveBeenCalled();
  });

  it("a drift 409 does not consume the daily budget (no drift-spam drain)", async () => {
    process.env.AI_DAILY_BUDGET = "1";
    _resetAiBudgetForTest();
    octoWith("export function x() {\n  return 2;\n}\n"); // drift → 409
    expect((await call()).status).toBe(409);
    // The single budget unit survived — a real aligned call still goes through.
    octoWith(SRC);
    expect((await call()).status).toBe(200);
  });
});

describe("POST explain — private repo", () => {
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
