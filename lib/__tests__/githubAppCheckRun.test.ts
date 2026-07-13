// The Gate (G-1): the blast verdict maps to an honest Check Run conclusion, and
// the poster find-or-updates without ever throwing (a missing checks:write just
// skips).

import { describe, it, expect, vi } from "vitest";
import {
  gateOutput,
  postCheckRun,
  CHECK_NAME,
  type CheckRunDeps,
} from "../githubApp/checkRun";
import type { ChangeBlastReport } from "../changeBlast/types";

function report(overrides: Partial<ChangeBlastReport> = {}): ChangeBlastReport {
  return {
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
    verdict: "clear",
    headline: "No load-bearing code changed.",
    ...overrides,
  };
}

const opts = { mergeUrl: "https://codetrawl.com/session/head/merge" };

describe("gateOutput — honest verdict → conclusion", () => {
  it("maps clear → success, review → neutral, high-risk → failure", () => {
    expect(gateOutput(report({ verdict: "clear" }), opts).conclusion).toBe("success");
    expect(gateOutput(report({ verdict: "review" }), opts).conclusion).toBe("neutral");
    expect(gateOutput(report({ verdict: "high-risk" }), opts).conclusion).toBe("failure");
  });

  it("titles high-risk with the load-bearing + reach counts", () => {
    const out = gateOutput(
      report({ verdict: "high-risk", loadBearingTouched: ["core.ts"], combinedDependents: 15 }),
      opts,
    );
    expect(out.title).toMatch(/High blast/);
    expect(out.title).toMatch(/1 load-bearing wall/);
    expect(out.title).toMatch(/15 files/);
  });

  it("puts the headline + merge link in the summary, and the receipt link only when given", () => {
    const noReceipt = gateOutput(report({ headline: "Touches 1 wall." }), opts);
    expect(noReceipt.summary).toMatch(/Touches 1 wall\./);
    expect(noReceipt.summary).toMatch(/Merge confidence/);
    expect(noReceipt.summary).not.toMatch(/Merge receipt/);

    const withReceipt = gateOutput(report(), {
      ...opts,
      receiptUrl: "https://codetrawl.com/r/abc",
    });
    expect(withReceipt.summary).toMatch(/Merge receipt/);
  });
});

describe("postCheckRun — find-or-update, never throws", () => {
  function fakeOctokit(existing: number[] = []) {
    return {
      rest: {
        checks: {
          listForRef: vi.fn(async () => ({
            data: { check_runs: existing.map((id) => ({ id })) },
          })),
          create: vi.fn(async () => ({ data: { id: 999 } })),
          update: vi.fn(async () => ({ data: { id: 888 } })),
        },
      },
    };
  }

  const input = {
    installationId: 1,
    owner: "o",
    repo: "r",
    headSha: "c".repeat(40),
    output: { conclusion: "success" as const, title: "Clear", summary: "ok" },
    detailsUrl: "https://x/merge",
  };

  it("creates a check when none exists for the sha", async () => {
    const octo = fakeOctokit([]);
    const deps: CheckRunDeps = {
      getInstallationClient: vi.fn(async () => octo as never),
    };
    const r = await postCheckRun(input, deps);
    expect(r).toEqual({ action: "created", checkRunId: 999 });
    expect(octo.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: CHECK_NAME,
        head_sha: input.headSha,
        conclusion: "success",
      }),
    );
  });

  it("updates in place when a check already exists for the sha", async () => {
    const octo = fakeOctokit([5]);
    const deps: CheckRunDeps = {
      getInstallationClient: vi.fn(async () => octo as never),
    };
    const r = await postCheckRun(input, deps);
    expect(r).toEqual({ action: "updated", checkRunId: 888 });
    expect(octo.rest.checks.update).toHaveBeenCalledOnce();
  });

  it("skips (never throws) when auth fails", async () => {
    const deps: CheckRunDeps = {
      getInstallationClient: vi.fn(async () => {
        throw new Error("no installation token");
      }),
    };
    const r = await postCheckRun(input, deps);
    expect(r.action).toBe("skipped");
  });

  it("skips when the create fails (e.g. missing checks:write)", async () => {
    const octo = fakeOctokit([]);
    octo.rest.checks.create = vi.fn(async () => {
      throw new Error("Resource not accessible by integration");
    });
    const deps: CheckRunDeps = {
      getInstallationClient: vi.fn(async () => octo as never),
    };
    const r = await postCheckRun(input, deps);
    expect(r.action).toBe("skipped");
  });
});
