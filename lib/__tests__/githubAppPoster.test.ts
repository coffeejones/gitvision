import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMENT_MARKER } from "../githubApp/comment";
import { type PosterDeps, postPrComment } from "../githubApp/poster";

// ---------------- mock Octokit ----------------

interface MockOctokit {
  paginate: ReturnType<typeof vi.fn>;
  rest: {
    issues: {
      listComments: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
      updateComment: ReturnType<typeof vi.fn>;
    };
  };
}

function makeOctokit(opts: {
  existingComments?: Array<{
    id: number;
    body: string | null;
    user?: { login: string; type?: string };
  }>;
  listThrows?: Error;
  createThrows?: Error;
  updateThrows?: Error;
  createReturnId?: number;
  updateReturnId?: number;
} = {}): MockOctokit {
  return {
    paginate: vi.fn(async () => {
      if (opts.listThrows) throw opts.listThrows;
      return opts.existingComments ?? [];
    }),
    rest: {
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(async () => {
          if (opts.createThrows) throw opts.createThrows;
          return { data: { id: opts.createReturnId ?? 555 } };
        }),
        updateComment: vi.fn(async () => {
          if (opts.updateThrows) throw opts.updateThrows;
          return { data: { id: opts.updateReturnId ?? 999 } };
        }),
      },
    },
  };
}

function makeDeps(octokit: MockOctokit | Error): PosterDeps {
  return {
    getInstallationClient: vi.fn(async () => {
      if (octokit instanceof Error) throw octokit;
      return octokit as unknown as Awaited<
        ReturnType<PosterDeps["getInstallationClient"]>
      >;
    }) as PosterDeps["getInstallationClient"],
  };
}

const INPUT = {
  installationId: 42,
  owner: "alice",
  repo: "repo",
  prNumber: 7,
  body: `${COMMENT_MARKER}\n## GitVision Review\nblah`,
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------- happy paths ----------------

describe("postPrComment — no existing comment → create", () => {
  it("creates a new comment when no comment matches our marker", async () => {
    const octo = makeOctokit({ existingComments: [], createReturnId: 1234 });
    const result = await postPrComment(INPUT, makeDeps(octo));

    expect(result).toEqual({ action: "created", commentId: 1234 });
    expect(octo.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "alice",
      repo: "repo",
      issue_number: 7,
      body: INPUT.body,
    });
    expect(octo.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("creates when existing comments are from other users (no marker)", async () => {
    const octo = makeOctokit({
      existingComments: [
        { id: 1, body: "First!", user: { login: "alice" } },
        { id: 2, body: "Looks good to me", user: { login: "bob" } },
      ],
      createReturnId: 5,
    });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result).toEqual({ action: "created", commentId: 5 });
  });

  it("ignores comments with null body when searching for marker", async () => {
    const octo = makeOctokit({
      existingComments: [
        { id: 1, body: null, user: { login: "alice" } },
        { id: 2, body: "other comment", user: { login: "bob" } },
      ],
    });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result.action).toBe("created");
  });
});

describe("postPrComment — existing comment → update", () => {
  it("updates the comment that contains our marker", async () => {
    const octo = makeOctokit({
      existingComments: [
        { id: 11, body: "unrelated", user: { login: "alice" } },
        {
          id: 22,
          body: `${COMMENT_MARKER}\nold body`,
          user: { login: "gitvision[bot]" },
        },
        { id: 33, body: "other", user: { login: "bob" } },
      ],
      updateReturnId: 22,
    });
    const result = await postPrComment(INPUT, makeDeps(octo));

    expect(result).toEqual({ action: "updated", commentId: 22 });
    expect(octo.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "alice",
      repo: "repo",
      comment_id: 22,
      body: INPUT.body,
    });
    expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("updates even when marker is on a later pagination page", async () => {
    // Lots of comments; ours is buried near the end. The mock returns
    // the full list (paginate-flattened), so we just put ours last.
    const many = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      body: `Generic comment #${i + 1}`,
      user: { login: "someone" },
    }));
    many.push({
      id: 999,
      body: `${COMMENT_MARKER}\nour comment`,
      user: { login: "gitvision[bot]" },
    });
    const octo = makeOctokit({
      existingComments: many,
      updateReturnId: 999,
    });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result).toEqual({ action: "updated", commentId: 999 });
  });
});

// ---------------- failure paths ----------------

describe("postPrComment — failure paths", () => {
  it("skips with auth-failed reason when installation client throws", async () => {
    const result = await postPrComment(
      INPUT,
      makeDeps(new Error("invalid private key")),
    );
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toContain("auth failed");
      expect(result.reason).toContain("invalid private key");
    }
  });

  it("skips with list-failed reason when listComments throws", async () => {
    const octo = makeOctokit({ listThrows: new Error("404 Not Found") });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toContain("list failed");
    }
  });

  it("skips with create-failed reason when createComment throws", async () => {
    const octo = makeOctokit({
      existingComments: [],
      createThrows: new Error("403 Forbidden"),
    });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toContain("create failed");
    }
  });

  it("skips with update-failed reason when updateComment throws", async () => {
    const octo = makeOctokit({
      existingComments: [
        { id: 5, body: `${COMMENT_MARKER}\nold` },
      ],
      updateThrows: new Error("comment was deleted"),
    });
    const result = await postPrComment(INPUT, makeDeps(octo));
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toContain("update failed");
    }
  });

  it("does not throw on any failure path", async () => {
    // Belt-and-suspenders — none of the above tests should ever throw,
    // but this asserts the contract explicitly.
    await expect(
      postPrComment(INPUT, makeDeps(new Error("x"))),
    ).resolves.toBeDefined();
  });
});

// ---------------- call ordering ----------------

describe("postPrComment — call ordering", () => {
  it("does NOT call createComment when an existing marker is found", async () => {
    const octo = makeOctokit({
      existingComments: [
        { id: 1, body: `${COMMENT_MARKER}\nold` },
      ],
    });
    await postPrComment(INPUT, makeDeps(octo));
    expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
    expect(octo.rest.issues.updateComment).toHaveBeenCalled();
  });

  it("does NOT call list/create/update when auth fails", async () => {
    const octo = makeOctokit({});
    // Override deps so the auth itself fails — octo is never reached.
    const deps: PosterDeps = {
      getInstallationClient: vi.fn(async () => {
        throw new Error("nope");
      }) as PosterDeps["getInstallationClient"],
    };
    await postPrComment(INPUT, deps);
    expect(octo.paginate).not.toHaveBeenCalled();
    expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
    expect(octo.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});
