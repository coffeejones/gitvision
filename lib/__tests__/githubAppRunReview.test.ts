import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestEvent } from "../githubApp/events/pullRequest";
import type { PipelineResult } from "../githubApp/pipeline";
import { type RunReviewDeps, runReview } from "../githubApp/runReview";

// ---------------- fixtures ----------------

function makeEvent(
  overrides: Partial<{
    fullName: string;
    installationId: number | undefined;
    prNumber: number;
  }> = {},
): PullRequestEvent {
  return {
    action: "opened",
    pull_request: {
      number: overrides.prNumber ?? 7,
      draft: false,
      user: { login: "alice" },
      base: { sha: "a".repeat(40), ref: "main" },
      head: { sha: "b".repeat(40), ref: "feature" },
    },
    repository: {
      full_name: overrides.fullName ?? "alice/repo",
      private: false,
      clone_url: "https://github.com/alice/repo.git",
    },
    installation:
      overrides.installationId === undefined
        ? { id: 42 }
        : { id: overrides.installationId },
  };
}

function makeOkPipelineResult(): PipelineResult {
  return {
    ok: true,
    baseSessionId: "sess-base",
    headSessionId: "sess-head",
    diffSummary: {
      filesChanged: 1,
      functionsAdded: 0,
      functionsRemoved: 0,
      functionsModified: 1,
      netComplexityDelta: 0,
    },
    suggestions: [],
    durationMs: 100,
  };
}

function makeFailPipelineResult(): PipelineResult {
  return {
    ok: false,
    step: "analyze-base",
    reason: "git clone failed",
    durationMs: 50,
  };
}

interface DepsOverrides {
  pipelineResult?: PipelineResult;
  commentBody?: string | null;
  postResult?: Awaited<
    ReturnType<RunReviewDeps["postPrComment"]>
  >;
}

function makeDeps(overrides: DepsOverrides = {}): RunReviewDeps {
  // Use the `in` operator so explicit null (test "skip on failure")
  // doesn't get nullish-coalesced back to the default body.
  const body =
    "commentBody" in overrides
      ? overrides.commentBody
      : "## GitVision Review\nhi";
  return {
    runAnalysisPipeline: vi.fn(
      async () => overrides.pipelineResult ?? makeOkPipelineResult(),
    ) as unknown as RunReviewDeps["runAnalysisPipeline"],
    formatPrComment: vi.fn(
      () => body,
    ) as unknown as RunReviewDeps["formatPrComment"],
    postPrComment: vi.fn(
      async () =>
        overrides.postResult ?? {
          action: "created",
          commentId: 100,
        },
    ) as unknown as RunReviewDeps["postPrComment"],
    pipelineDeps: {} as RunReviewDeps["pipelineDeps"],
    posterDeps: {} as RunReviewDeps["posterDeps"],
    workspaceBaseUrl: "https://gitvision.net",
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------- happy path ----------------

describe("runReview — happy path", () => {
  it("runs pipeline → formats → posts when everything succeeds", async () => {
    const deps = makeDeps();
    const result = await runReview(makeEvent(), deps, "d-1");

    expect(result.ok).toBe(true);
    expect(deps.runAnalysisPipeline).toHaveBeenCalledTimes(1);
    expect(deps.formatPrComment).toHaveBeenCalledTimes(1);
    expect(deps.postPrComment).toHaveBeenCalledTimes(1);
  });

  it("passes the rendered body + parsed owner/repo/pr to postPrComment", async () => {
    const deps = makeDeps({
      commentBody: "## GitVision Review\nbody",
      postResult: { action: "created", commentId: 5 },
    });
    await runReview(
      makeEvent({ fullName: "octocat/hello-world", prNumber: 42 }),
      deps,
    );

    const postMock = deps.postPrComment as unknown as ReturnType<typeof vi.fn>;
    expect(postMock.mock.calls[0]?.[0]).toMatchObject({
      installationId: 42,
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      body: "## GitVision Review\nbody",
    });
  });

  it("passes workspaceBaseUrl through to the formatter", async () => {
    const deps = makeDeps();
    await runReview(makeEvent(), deps);

    const fmtMock = deps.formatPrComment as unknown as ReturnType<typeof vi.fn>;
    expect(fmtMock.mock.calls[0]?.[1]).toEqual({
      workspaceBaseUrl: "https://gitvision.net",
    });
  });
});

// ---------------- skip paths ----------------

describe("runReview — skip paths", () => {
  it("skips posting when pipeline fails (formatter returns null)", async () => {
    const deps = makeDeps({
      pipelineResult: makeFailPipelineResult(),
      commentBody: null,
    });
    const result = await runReview(makeEvent(), deps);

    expect(result.ok).toBe(false);
    expect(deps.runAnalysisPipeline).toHaveBeenCalledTimes(1);
    expect(deps.formatPrComment).toHaveBeenCalledTimes(1);
    expect(deps.postPrComment).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.pipelineResult).toEqual(makeFailPipelineResult());
    }
  });

  it("skips posting + formatting when event has no installation id", async () => {
    const deps = makeDeps();
    const result = await runReview(makeEvent({ installationId: 0 }), deps);

    // installationId=0 → falsy; we bail before doing any work.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("installation");
    }
    expect(deps.runAnalysisPipeline).not.toHaveBeenCalled();
    expect(deps.postPrComment).not.toHaveBeenCalled();
  });

  it("skips when repository.full_name is malformed", async () => {
    const deps = makeDeps();
    const result = await runReview(
      makeEvent({ fullName: "no-slash-here" }),
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("full_name");
    }
    expect(deps.runAnalysisPipeline).not.toHaveBeenCalled();
    expect(deps.postPrComment).not.toHaveBeenCalled();
  });

  it("returns ok with post=skipped when poster fails internally", async () => {
    const deps = makeDeps({
      postResult: { action: "skipped", reason: "create failed: 403" },
    });
    const result = await runReview(makeEvent(), deps);

    // runReview's overall ok flag is true (the orchestration completed);
    // the post failure is reflected inside postResult so the caller can
    // distinguish "we tried but GitHub rejected" from "we never tried".
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.postResult.action).toBe("skipped");
    }
  });
});

// ---------------- composition fidelity ----------------

describe("runReview — composition fidelity", () => {
  it("still posts when pipeline returns 0 suggestions (formatter produces body)", async () => {
    const deps = makeDeps({
      pipelineResult: makeOkPipelineResult(),
      commentBody:
        "## GitVision Review\n\nNothing notable on this PR ✅",
    });
    await runReview(makeEvent(), deps);

    expect(deps.postPrComment).toHaveBeenCalledTimes(1);
  });

  it("propagates updated postResult when comment already existed", async () => {
    const deps = makeDeps({
      postResult: { action: "updated", commentId: 999 },
    });
    const result = await runReview(makeEvent(), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.postResult).toEqual({
        action: "updated",
        commentId: 999,
      });
    }
  });
});
