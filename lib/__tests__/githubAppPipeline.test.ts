import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestEvent } from "../githubApp/events/pullRequest";
import {
  type PipelineDeps,
  runAnalysisPipeline,
} from "../githubApp/pipeline";

// -------------- test fixtures --------------

function makeEvent(
  overrides: Partial<{
    baseSha: string;
    headSha: string;
    prNumber: number;
    cloneUrl: string;
  }> = {},
): PullRequestEvent {
  return {
    action: "opened",
    pull_request: {
      number: overrides.prNumber ?? 42,
      draft: false,
      user: { login: "alice" },
      base: { sha: overrides.baseSha ?? "a".repeat(40), ref: "main" },
      head: { sha: overrides.headSha ?? "b".repeat(40), ref: "feature/x" },
    },
    repository: {
      full_name: "alice/repo",
      private: false,
      clone_url: overrides.cloneUrl ?? "https://github.com/alice/repo.git",
    },
    installation: { id: 99 },
  };
}

// Minimal CodeGraph stand-in. The diff/rules deps are mocked so the
// real shape doesn't matter; an empty object is plenty.
const FAKE_CODE_GRAPH = { functions: [] };
const FAKE_DIFF = {
  summary: {
    filesChanged: 3,
    functionsAdded: 5,
    functionsRemoved: 2,
    functionsModified: 7,
    netComplexityDelta: 4,
  },
  changes: [],
};
const FAKE_SUGGESTIONS = [
  {
    ruleId: "complexity-increase-without-test",
    severity: "critical" as const,
    impactScore: 4,
    text: "load_dotenv grew +4 complexity",
    evidence: ["complexity_delta=4"],
  },
];
const FAKE_BASE_SNAPSHOT = {
  codeGraph: FAKE_CODE_GRAPH,
} as unknown as Awaited<ReturnType<PipelineDeps["analyzeRepo"]>>;
const FAKE_HEAD_SNAPSHOT = {
  codeGraph: FAKE_CODE_GRAPH,
} as unknown as Awaited<ReturnType<PipelineDeps["analyzeRepo"]>>;
const FAKE_BLAST = {
  hasGraphs: true,
  changedFiles: [],
  wallsTouched: [],
  loadBearingTouched: [],
  combinedDependents: 0,
  functionsAdded: 0,
  functionsRemoved: 0,
  testFilesChanged: 0,
  testsToRun: [],
  mappedTestsUpdated: 0,
  verdict: "clear" as const,
  headline: "No load-bearing code changed.",
};

interface MockOverrides {
  parseRepoUrl?: PipelineDeps["parseRepoUrl"];
  analyzeRepo?: PipelineDeps["analyzeRepo"];
  computeDiff?: PipelineDeps["computeDiff"];
  computeChangeBlast?: PipelineDeps["computeChangeBlast"];
  evaluateVerificationRules?: PipelineDeps["evaluateVerificationRules"];
  createSession?: PipelineDeps["createSession"];
}

function makeDeps(overrides: MockOverrides = {}): PipelineDeps {
  return {
    parseRepoUrl:
      overrides.parseRepoUrl ??
      vi.fn(() => ({ owner: "alice", repo: "repo" })),
    analyzeRepo:
      overrides.analyzeRepo ??
      (vi
        .fn()
        .mockResolvedValueOnce(FAKE_BASE_SNAPSHOT)
        .mockResolvedValueOnce(
          FAKE_HEAD_SNAPSHOT,
        ) as unknown as PipelineDeps["analyzeRepo"]),
    computeDiff:
      overrides.computeDiff ??
      (vi.fn(
        () => FAKE_DIFF,
      ) as unknown as PipelineDeps["computeDiff"]),
    computeChangeBlast:
      overrides.computeChangeBlast ??
      (vi.fn(
        () => FAKE_BLAST,
      ) as unknown as PipelineDeps["computeChangeBlast"]),
    evaluateVerificationRules:
      overrides.evaluateVerificationRules ??
      (vi.fn(
        () => FAKE_SUGGESTIONS,
      ) as unknown as PipelineDeps["evaluateVerificationRules"]),
    createSession:
      overrides.createSession ??
      (vi
        .fn()
        .mockResolvedValueOnce({ id: "sess-base" })
        .mockResolvedValueOnce({
          id: "sess-head",
        }) as unknown as PipelineDeps["createSession"]),
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------- happy path --------------

describe("runAnalysisPipeline — happy path", () => {
  it("returns ok with session ids, summary, and suggestions", async () => {
    const deps = makeDeps();
    const result = await runAnalysisPipeline(makeEvent(), deps, "d-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.baseSessionId).toBe("sess-base");
      expect(result.headSessionId).toBe("sess-head");
      expect(result.suggestions).toEqual(FAKE_SUGGESTIONS);
      expect(result.diffSummary).toEqual(FAKE_DIFF.summary);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("calls analyzeRepo twice — once per ref, in order base then head", async () => {
    const analyzeRepoSpy = vi
      .fn()
      .mockResolvedValueOnce(FAKE_BASE_SNAPSHOT)
      .mockResolvedValueOnce(FAKE_HEAD_SNAPSHOT) as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({ analyzeRepo: analyzeRepoSpy });

    await runAnalysisPipeline(
      makeEvent({ baseSha: "aaa".repeat(13) + "a", headSha: "bbb".repeat(13) + "b" }),
      deps,
    );

    const mock = analyzeRepoSpy as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenNthCalledWith(1, "alice", "repo", {
      ref: "aaa".repeat(13) + "a",
    });
    expect(mock).toHaveBeenNthCalledWith(2, "alice", "repo", {
      ref: "bbb".repeat(13) + "b",
    });
  });

  it("creates two sessions with PR-flavored names", async () => {
    const createSessionSpy = vi
      .fn()
      .mockResolvedValueOnce({ id: "sess-base" })
      .mockResolvedValueOnce({
        id: "sess-head",
      }) as unknown as PipelineDeps["createSession"];
    const deps = makeDeps({ createSession: createSessionSpy });

    await runAnalysisPipeline(
      makeEvent({ baseSha: "12345678".padEnd(40, "0"), prNumber: 7 }),
      deps,
    );

    const mock = createSessionSpy as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);

    const baseCall = mock.mock.calls[0]?.[0] as { name: string };
    const headCall = mock.mock.calls[1]?.[0] as { name: string };
    expect(baseCall.name).toContain("base of PR #7");
    expect(baseCall.name).toContain("12345678");
    expect(headCall.name).toContain("PR #7");
  });

  it("tags both sessions with the installation id (so deleted-event GC works)", async () => {
    const createSessionSpy = vi
      .fn()
      .mockResolvedValueOnce({ id: "sess-base" })
      .mockResolvedValueOnce({
        id: "sess-head",
      }) as unknown as PipelineDeps["createSession"];
    const deps = makeDeps({ createSession: createSessionSpy });

    await runAnalysisPipeline(makeEvent(), deps);

    const mock = createSessionSpy as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls[0]?.[0]).toMatchObject({ installationId: 99 });
    expect(mock.mock.calls[1]?.[0]).toMatchObject({ installationId: 99 });
  });

  it("records prMetadata on the HEAD session so Merge Confidence can find the base", async () => {
    const createSessionSpy = vi
      .fn()
      .mockResolvedValueOnce({ id: "sess-base" })
      .mockResolvedValueOnce({
        id: "sess-head",
      }) as unknown as PipelineDeps["createSession"];
    const deps = makeDeps({ createSession: createSessionSpy });

    await runAnalysisPipeline(makeEvent({ prNumber: 7 }), deps);

    const mock = createSessionSpy as unknown as ReturnType<typeof vi.fn>;
    // Base session is the diff target, not a PR view — no prMetadata.
    expect(mock.mock.calls[0]?.[0]?.prMetadata).toBeUndefined();
    // Head session points back at the base session + carries the PR number.
    expect(mock.mock.calls[1]?.[0]).toMatchObject({
      prMetadata: { baseSessionId: "sess-base", prNumber: 7 },
    });
  });

  it("caps suggestions at maxResults=3", async () => {
    const ruleSpy = vi.fn(() => FAKE_SUGGESTIONS) as unknown as PipelineDeps["evaluateVerificationRules"];
    const deps = makeDeps({ evaluateVerificationRules: ruleSpy });

    await runAnalysisPipeline(makeEvent(), deps);

    const mock = ruleSpy as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[1]).toEqual({ maxResults: 3 });
  });
});

// -------------- failure paths --------------

describe("runAnalysisPipeline — failure paths", () => {
  it("returns step=parse when clone_url can't be parsed", async () => {
    const deps = makeDeps({
      parseRepoUrl: vi.fn(() => null),
    });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("parse");
      expect(result.reason).toContain("clone_url");
    }
  });

  it("returns step=analyze-base when first analyzeRepo throws", async () => {
    const analyzeRepoSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("git clone failed")) as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({ analyzeRepo: analyzeRepoSpy });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("analyze-base");
      expect(result.reason).toContain("git clone failed");
    }
  });

  it("returns step=analyze-head when second analyzeRepo throws", async () => {
    const analyzeRepoSpy = vi
      .fn()
      .mockResolvedValueOnce(FAKE_BASE_SNAPSHOT)
      .mockRejectedValueOnce(
        new Error("head ref not found"),
      ) as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({ analyzeRepo: analyzeRepoSpy });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("analyze-head");
      expect(result.reason).toContain("head ref not found");
    }
  });

  it("returns step=missing-code-graph when base lacks codeGraph", async () => {
    const noGraphSnap = {
      codeGraphSkipReason: "no supported language files",
    } as unknown as Awaited<ReturnType<PipelineDeps["analyzeRepo"]>>;
    const analyzeRepoSpy = vi
      .fn()
      .mockResolvedValueOnce(noGraphSnap)
      .mockResolvedValueOnce(FAKE_HEAD_SNAPSHOT) as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({ analyzeRepo: analyzeRepoSpy });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("missing-code-graph");
      expect(result.reason).toContain("no supported language");
    }
  });

  it("returns step=missing-code-graph when head lacks codeGraph", async () => {
    const noGraphSnap = {
      codeGraphSkipReason: "trees truncated",
    } as unknown as Awaited<ReturnType<PipelineDeps["analyzeRepo"]>>;
    const analyzeRepoSpy = vi
      .fn()
      .mockResolvedValueOnce(FAKE_BASE_SNAPSHOT)
      .mockResolvedValueOnce(noGraphSnap) as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({ analyzeRepo: analyzeRepoSpy });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("missing-code-graph");
    }
  });

  it("returns step=persist when createSession throws", async () => {
    const createSessionSpy = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("disk full"),
      ) as unknown as PipelineDeps["createSession"];
    const deps = makeDeps({ createSession: createSessionSpy });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("persist");
      expect(result.reason).toContain("disk full");
    }
  });

  it("returns step=unknown if computeDiff throws", async () => {
    const deps = makeDeps({
      computeDiff: vi.fn(() => {
        throw new Error("graph corruption");
      }) as unknown as PipelineDeps["computeDiff"],
    });

    const result = await runAnalysisPipeline(makeEvent(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("unknown");
      expect(result.reason).toContain("graph corruption");
    }
  });

  it("includes durationMs even on failure", async () => {
    const deps = makeDeps({ parseRepoUrl: vi.fn(() => null) });
    const result = await runAnalysisPipeline(makeEvent(), deps);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// -------------- call-order assurance --------------

describe("runAnalysisPipeline — call ordering", () => {
  it("does NOT call analyzeRepo when parseRepoUrl fails", async () => {
    const analyzeRepoSpy = vi.fn() as unknown as PipelineDeps["analyzeRepo"];
    const deps = makeDeps({
      parseRepoUrl: vi.fn(() => null),
      analyzeRepo: analyzeRepoSpy,
    });

    await runAnalysisPipeline(makeEvent(), deps);
    expect(analyzeRepoSpy).not.toHaveBeenCalled();
  });

  it("does NOT call computeDiff when analyze-base fails", async () => {
    const computeDiffSpy = vi.fn() as unknown as PipelineDeps["computeDiff"];
    const deps = makeDeps({
      analyzeRepo: vi
        .fn()
        .mockRejectedValueOnce(new Error("x")) as unknown as PipelineDeps["analyzeRepo"],
      computeDiff: computeDiffSpy,
    });

    await runAnalysisPipeline(makeEvent(), deps);
    expect(computeDiffSpy).not.toHaveBeenCalled();
  });

  it("does NOT call createSession when codeGraph is missing", async () => {
    const noGraphSnap = {
      codeGraphSkipReason: "no code",
    } as unknown as Awaited<ReturnType<PipelineDeps["analyzeRepo"]>>;
    const createSessionSpy = vi.fn() as unknown as PipelineDeps["createSession"];
    const deps = makeDeps({
      analyzeRepo: vi
        .fn()
        .mockResolvedValueOnce(noGraphSnap)
        .mockResolvedValueOnce(
          noGraphSnap,
        ) as unknown as PipelineDeps["analyzeRepo"],
      createSession: createSessionSpy,
    });

    await runAnalysisPipeline(makeEvent(), deps);
    expect(createSessionSpy).not.toHaveBeenCalled();
  });
});
