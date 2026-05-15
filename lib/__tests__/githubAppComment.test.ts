import { describe, expect, it } from "vitest";

import type { DiffSummary } from "../codeAnalysis/diffAware";
import type { VerificationSuggestion } from "../codeAnalysis/verificationRules";
import { COMMENT_MARKER, formatPrComment } from "../githubApp/comment";
import type { PipelineResult } from "../githubApp/pipeline";

interface OkResultOverrides {
  suggestions?: VerificationSuggestion[];
  diffSummary?: DiffSummary;
  headSessionId?: string;
  baseSessionId?: string;
}

function okResult(overrides: OkResultOverrides = {}): PipelineResult {
  return {
    ok: true,
    baseSessionId: overrides.baseSessionId ?? "sess-base",
    headSessionId: overrides.headSessionId ?? "sess-head",
    diffSummary: overrides.diffSummary ?? {
      filesChanged: 3,
      functionsAdded: 5,
      functionsRemoved: 2,
      functionsModified: 7,
      netComplexityDelta: 4,
    },
    suggestions: overrides.suggestions ?? [
      {
        ruleId: "complexity-increase-without-test",
        severity: "critical",
        impactScore: 4,
        text: "load_dotenv in `src/flask/cli.py` grew by +4 cyclomatic complexity (9 → 13).",
        evidence: ["complexity_before=9", "complexity_after=13"],
      },
      {
        ruleId: "removed-function-with-impact",
        severity: "warning",
        impactScore: 2,
        text: "_path_is_relative_to was removed from `src/flask/sansio/scaffold.py` (original complexity 2).",
        evidence: ["status=removed"],
      },
      {
        ruleId: "large-pr-overview",
        severity: "info",
        impactScore: 23,
        text: "Sizeable PR — touches 23 files with 109 function-level changes.",
        evidence: ["files_changed=23"],
      },
    ],
    durationMs: 1234,
  };
}

const CTX = { workspaceBaseUrl: "https://gitvision.net" };

describe("formatPrComment — failed pipeline", () => {
  it("returns null when pipeline failed", () => {
    const result: PipelineResult = {
      ok: false,
      step: "analyze-base",
      reason: "git clone failed",
      durationMs: 500,
    };
    expect(formatPrComment(result, CTX)).toBeNull();
  });

  it.each([
    "parse",
    "analyze-base",
    "analyze-head",
    "missing-code-graph",
    "persist",
    "unknown",
  ] as const)("returns null for step=%s failure", (step) => {
    const result: PipelineResult = {
      ok: false,
      step,
      reason: "whatever",
      durationMs: 1,
    };
    expect(formatPrComment(result, CTX)).toBeNull();
  });
});

describe("formatPrComment — happy path", () => {
  it("includes the marker comment at the top", () => {
    const out = formatPrComment(okResult(), CTX);
    expect(out).not.toBeNull();
    expect(out!.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("includes the GitVision Review heading", () => {
    const out = formatPrComment(okResult(), CTX);
    expect(out).toContain("## GitVision Review");
  });

  it("renders all three suggestions with correct severity emoji", () => {
    const out = formatPrComment(okResult(), CTX)!;
    expect(out).toContain("🔴 **CRITICAL**");
    expect(out).toContain("🟡 **WARNING**");
    expect(out).toContain("🟢 **INFO**");
  });

  it("numbers suggestions 1, 2, 3", () => {
    const out = formatPrComment(okResult(), CTX)!;
    expect(out).toContain("1. 🔴");
    expect(out).toContain("2. 🟡");
    expect(out).toContain("3. 🟢");
  });

  it("includes the suggestion-count in the section heading", () => {
    const out = formatPrComment(okResult(), CTX)!;
    expect(out).toContain("Suggested verification (top 3)");
  });

  it("includes the analysis link pointing to the head session", () => {
    const out = formatPrComment(
      okResult({ headSessionId: "abc123def" }),
      CTX,
    )!;
    expect(out).toContain(
      "[Full analysis ↗](https://gitvision.net/session/abc123def)",
    );
  });

  it("includes the deterministic-claim trust footer", () => {
    const out = formatPrComment(okResult(), CTX)!;
    expect(out).toContain("Signals computed deterministically");
    expect(out).toContain("no LLM in this comment");
  });

  it("normalizes trailing slash on workspaceBaseUrl", () => {
    const out = formatPrComment(
      okResult({ headSessionId: "x" }),
      { workspaceBaseUrl: "https://gitvision.net///" },
    )!;
    expect(out).toContain("https://gitvision.net/session/x");
    expect(out).not.toContain("https://gitvision.net///session/x");
  });
});

describe("formatPrComment — empty suggestions (nothing notable)", () => {
  it("renders a positive 'nothing notable' message", () => {
    const out = formatPrComment(okResult({ suggestions: [] }), CTX);
    expect(out).not.toBeNull();
    expect(out).toContain("Nothing notable on this PR ✅");
  });

  it("still includes the diff summary so reviewers see we ran", () => {
    const out = formatPrComment(okResult({ suggestions: [] }), CTX)!;
    expect(out).toContain("**Diff summary:**");
    expect(out).toContain("3 files changed");
  });

  it("still includes the marker and footer link", () => {
    const out = formatPrComment(okResult({ suggestions: [] }), CTX)!;
    expect(out).toContain(COMMENT_MARKER);
    expect(out).toContain("Full analysis");
  });

  it("does NOT include the suggested-verification heading", () => {
    const out = formatPrComment(okResult({ suggestions: [] }), CTX)!;
    expect(out).not.toContain("Suggested verification");
  });
});

describe("formatPrComment — diff summary formatting", () => {
  it("renders 'file' singular when filesChanged === 1", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 1,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 1,
          netComplexityDelta: 0,
        },
      }),
      CTX,
    )!;
    expect(out).toContain("1 file changed");
    expect(out).not.toContain("1 files changed");
  });

  it("renders 'files' plural otherwise", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 5,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 1,
          netComplexityDelta: 0,
        },
      }),
      CTX,
    )!;
    expect(out).toContain("5 files changed");
  });

  it("omits zero-count function buckets to keep the line scannable", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 2,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 3,
          netComplexityDelta: 0,
        },
      }),
      CTX,
    )!;
    expect(out).toContain("3 modified");
    expect(out).not.toContain("0 added");
    expect(out).not.toContain("0 removed");
  });

  it("omits the net-complexity part when delta is 0", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 1,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 1,
          netComplexityDelta: 0,
        },
      }),
      CTX,
    )!;
    expect(out).not.toContain("net complexity");
  });

  it("includes + sign for positive net-complexity delta", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 1,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 1,
          netComplexityDelta: 7,
        },
      }),
      CTX,
    )!;
    expect(out).toContain("net complexity +7");
  });

  it("renders negative net-complexity delta without an extra sign", () => {
    const out = formatPrComment(
      okResult({
        diffSummary: {
          filesChanged: 1,
          functionsAdded: 0,
          functionsRemoved: 0,
          functionsModified: 1,
          netComplexityDelta: -3,
        },
      }),
      CTX,
    )!;
    expect(out).toContain("net complexity -3");
    expect(out).not.toContain("net complexity +-3");
  });
});

describe("formatPrComment — output integrity", () => {
  it("output ends with a trailing newline (markdown courtesy)", () => {
    const out = formatPrComment(okResult(), CTX);
    expect(out!.endsWith("\n")).toBe(true);
  });

  it("contains a horizontal rule before the footer", () => {
    const out = formatPrComment(okResult(), CTX)!;
    expect(out).toContain("---");
  });

  it("is non-empty and under a sensible PR-comment size", () => {
    // GitHub's comment max is ~65k chars. We aim for <2k for the thin
    // v1 format; anything north of that means we're regressing toward
    // wall-of-text territory.
    const out = formatPrComment(okResult(), CTX);
    expect(out!.length).toBeGreaterThan(50);
    expect(out!.length).toBeLessThan(2_000);
  });
});
