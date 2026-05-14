import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlePullRequestEvent } from "../githubApp/events/pullRequest";

interface PrPayloadOverrides {
  action?: string;
  draft?: boolean;
  private?: boolean;
  authorLogin?: string;
  number?: number;
}

function makePayload(overrides: PrPayloadOverrides = {}): unknown {
  return {
    action: overrides.action ?? "opened",
    pull_request: {
      number: overrides.number ?? 42,
      draft: overrides.draft ?? false,
      user: { login: overrides.authorLogin ?? "alice" },
      base: { sha: "a".repeat(40), ref: "main" },
      head: { sha: "b".repeat(40), ref: "feature/x" },
      title: "Add duplicate-name validation",
      body: "Fixes a long-standing issue.",
    },
    repository: {
      full_name: "alice/repo",
      private: overrides.private ?? false,
      size: 12_000,
      clone_url: "https://github.com/alice/repo.git",
      default_branch: "main",
    },
    installation: { id: 99 },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePullRequestEvent — happy path", () => {
  it("accepts an opened PR from a human on a public non-draft repo", async () => {
    const result = await handlePullRequestEvent(makePayload(), "d-1");
    expect(result).toMatchObject({
      status: "accepted",
      reason: "passed all filters",
    });
  });

  it("attaches backgroundWork as a function when filters pass", async () => {
    const result = await handlePullRequestEvent(makePayload(), "d");
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(typeof result.backgroundWork).toBe("function");
    }
  });

  it("does not attach backgroundWork on skipped results", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ action: "labeled" }),
      "d",
    );
    expect(result.status).toBe("skipped");
    expect(
      (result as { backgroundWork?: unknown }).backgroundWork,
    ).toBeUndefined();
  });

  it("accepts synchronize (force-push / new commits)", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ action: "synchronize" }),
      "d-2",
    );
    expect(result.status).toBe("accepted");
  });

  it("accepts reopened (closed PR re-opened)", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ action: "reopened" }),
      "d-3",
    );
    expect(result.status).toBe("accepted");
  });

  it("accepts ready_for_review (draft transitioning to reviewable)", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ action: "ready_for_review" }),
      "d-4",
    );
    expect(result.status).toBe("accepted");
  });
});

describe("handlePullRequestEvent — action filter", () => {
  it.each([
    "closed",
    "edited",
    "labeled",
    "unlabeled",
    "assigned",
    "review_requested",
    "converted_to_draft",
  ])("skips action=%s", async (action) => {
    const result = await handlePullRequestEvent(
      makePayload({ action }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain(action);
    }
  });
});

describe("handlePullRequestEvent — repository filter", () => {
  it("skips private repos", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ private: true }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("private repo");
    }
  });
});

describe("handlePullRequestEvent — draft filter", () => {
  it("skips draft PRs", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ draft: true }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("draft PR");
    }
  });

  it("treats missing draft field as non-draft (GitHub omits it for non-draft PRs)", async () => {
    const payload = makePayload();
    const obj = payload as Record<string, unknown>;
    const pr = obj.pull_request as Record<string, unknown>;
    delete pr.draft;

    const result = await handlePullRequestEvent(payload, "d");
    expect(result.status).toBe("accepted");
  });
});

describe("handlePullRequestEvent — bot-author filter", () => {
  it.each([
    "dependabot[bot]",
    "renovate[bot]",
    "github-actions[bot]",
    "vercel-release-bot",
    "snyk-bot",
    "mergify[bot]",
  ])("skips PR from %s", async (login) => {
    const result = await handlePullRequestEvent(
      makePayload({ authorLogin: login }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("bot author");
    }
  });

  it("accepts PRs from human authors with bot-adjacent names", async () => {
    // "robot" doesn't match any pattern; should NOT be filtered.
    const result = await handlePullRequestEvent(
      makePayload({ authorLogin: "robotenthusiast" }),
      "d",
    );
    expect(result.status).toBe("accepted");
  });
});

describe("handlePullRequestEvent — payload validation", () => {
  it("returns error on completely malformed payload", async () => {
    const result = await handlePullRequestEvent({ not: "valid" }, "d");
    expect(result.status).toBe("error");
  });

  it("returns error when pull_request is missing", async () => {
    const result = await handlePullRequestEvent(
      { action: "opened", repository: { full_name: "x/y" } },
      "d",
    );
    expect(result.status).toBe("error");
  });

  it("returns error when repository.private has wrong type", async () => {
    const payload = makePayload();
    const obj = payload as Record<string, unknown>;
    const repo = obj.repository as Record<string, unknown>;
    repo.private = "yes"; // wrong type

    const result = await handlePullRequestEvent(payload, "d");
    expect(result.status).toBe("error");
  });

  it("returns error when payload is null", async () => {
    const result = await handlePullRequestEvent(null, "d");
    expect(result.status).toBe("error");
  });
});

describe("handlePullRequestEvent — filter ordering", () => {
  // Filter order matters for log clarity. We want the MOST informative
  // skip reason to fire first when multiple filters would apply.
  it("reports action skip before private-repo skip when both apply", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ action: "labeled", private: true }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("labeled");
    }
  });

  it("reports private skip before draft skip when both apply", async () => {
    const result = await handlePullRequestEvent(
      makePayload({ private: true, draft: true }),
      "d",
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("private repo");
    }
  });
});
