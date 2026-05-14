// Analysis pipeline for the GitHub App.
//
// Given a parsed pull_request event, this runs the full review chain:
//   1. Resolve the repo from the clone URL
//   2. analyzeRepo at base SHA
//   3. analyzeRepo at head SHA
//   4. Persist both as sessions (public-by-default per design Q1)
//   5. computeDiff(base.codeGraph, head.codeGraph)
//   6. evaluateVerificationRules(diff) → top-3 suggestions
//
// Returns a tagged result so callers (route handler in Commit 4,
// comment poster in Commit 6) can decide how to react. We never
// throw — every failure path produces a typed PipelineFailure.
//
// Heavy: typical runtime is 30s-2min depending on repo size. Caller
// schedules this via Next.js's `after()` so the webhook responds 200
// immediately. See eval/strategy/github-app-skeleton-2026-05.md.
//
// Dependency injection: production wires up the real analyzeRepo /
// computeDiff / etc via defaultPipelineDeps. Tests pass mocks so the
// orchestration can be tested without hitting GitHub.

import { computeDiff } from "../codeAnalysis/diffAware";
import type { DiffSummary } from "../codeAnalysis/diffAware";
import { evaluateVerificationRules } from "../codeAnalysis/verificationRules";
import type { VerificationSuggestion } from "../codeAnalysis/verificationRules";
import { analyzeRepo, parseRepoUrl } from "../github";
import { createSession } from "../storage";

import type { PullRequestEvent } from "./events/pullRequest";

export interface PipelineDeps {
  parseRepoUrl: typeof parseRepoUrl;
  analyzeRepo: typeof analyzeRepo;
  computeDiff: typeof computeDiff;
  evaluateVerificationRules: typeof evaluateVerificationRules;
  createSession: typeof createSession;
}

/**
 * Production wiring. Tests construct their own deps object with mocks.
 */
export const defaultPipelineDeps: PipelineDeps = {
  parseRepoUrl,
  analyzeRepo,
  computeDiff,
  evaluateVerificationRules,
  createSession,
};

export type PipelineStep =
  | "parse"
  | "analyze-base"
  | "analyze-head"
  | "missing-code-graph"
  | "persist"
  | "unknown";

export type PipelineResult =
  | {
      ok: true;
      baseSessionId: string;
      headSessionId: string;
      diffSummary: DiffSummary;
      suggestions: VerificationSuggestion[];
      durationMs: number;
    }
  | {
      ok: false;
      step: PipelineStep;
      reason: string;
      durationMs: number;
    };

/**
 * Run the full analysis chain for a PR event. Never throws.
 *
 * Returns the first error encountered, tagged with the step that
 * failed — useful both for logs and for future tooling that might
 * react differently (e.g. "couldn't analyze, post a polite skip
 * comment" vs. "transient error, retry").
 */
export async function runAnalysisPipeline(
  event: PullRequestEvent,
  deps: PipelineDeps = defaultPipelineDeps,
  deliveryId?: string | null,
): Promise<PipelineResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  const { repository: repo, pull_request: pr } = event;
  const repoUrl = repo.clone_url;
  const prNumber = pr.number;
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;

  // 1. Resolve the repo
  const parsed = deps.parseRepoUrl(repoUrl);
  if (!parsed) {
    const reason = `could not parse clone_url=${repoUrl}`;
    console.error(`[github-app pipeline] ${reason}`);
    return { ok: false, step: "parse", reason, durationMs: elapsed() };
  }
  const { owner, repo: repoName } = parsed;
  const logCtx = `delivery=${deliveryId ?? "—"} ${owner}/${repoName}#${prNumber}`;
  console.log(
    `[github-app pipeline] start ${logCtx} base=${baseSha.slice(0, 8)} head=${headSha.slice(0, 8)}`,
  );

  // 2. Analyze base ref
  let baseSnapshot;
  try {
    baseSnapshot = await deps.analyzeRepo(owner, repoName, { ref: baseSha });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app pipeline] base analysis failed ${logCtx}: ${msg}`);
    return {
      ok: false,
      step: "analyze-base",
      reason: `base analysis failed: ${msg}`,
      durationMs: elapsed(),
    };
  }

  // 3. Analyze head ref
  let headSnapshot;
  try {
    headSnapshot = await deps.analyzeRepo(owner, repoName, { ref: headSha });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app pipeline] head analysis failed ${logCtx}: ${msg}`);
    return {
      ok: false,
      step: "analyze-head",
      reason: `head analysis failed: ${msg}`,
      durationMs: elapsed(),
    };
  }

  // 4. Verify both snapshots have a codeGraph. Falls out for non-code
  // repos (markdown-only, all-binary), repos with no supported language,
  // or analysis bail-outs (truncated trees, etc.).
  if (!baseSnapshot.codeGraph || !headSnapshot.codeGraph) {
    const reason =
      baseSnapshot.codeGraphSkipReason ??
      headSnapshot.codeGraphSkipReason ??
      "codeGraph missing on one or both snapshots";
    console.warn(`[github-app pipeline] missing codeGraph ${logCtx}: ${reason}`);
    return {
      ok: false,
      step: "missing-code-graph",
      reason,
      durationMs: elapsed(),
    };
  }

  // 5. Persist both snapshots as sessions. Public-by-default per
  // design Q1 — link from PR comment goes to a public read-only view.
  let baseSession;
  let headSession;
  try {
    baseSession = await deps.createSession({
      repoUrl,
      name: `${owner}/${repoName} @ ${baseSha.slice(0, 8)} (base of PR #${prNumber})`,
      initialSnapshot: baseSnapshot,
    });
    headSession = await deps.createSession({
      repoUrl,
      name: `${owner}/${repoName} @ ${headSha.slice(0, 8)} (PR #${prNumber})`,
      initialSnapshot: headSnapshot,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[github-app pipeline] session persistence failed ${logCtx}: ${msg}`,
    );
    return {
      ok: false,
      step: "persist",
      reason: `session persistence failed: ${msg}`,
      durationMs: elapsed(),
    };
  }

  // 6. Diff + rules. Pure functions — should never throw, but wrap
  // defensively for robustness.
  let diff;
  let suggestions;
  try {
    diff = deps.computeDiff(baseSnapshot.codeGraph, headSnapshot.codeGraph);
    suggestions = deps.evaluateVerificationRules(
      { diff },
      { maxResults: 3 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app pipeline] diff/rules failed ${logCtx}: ${msg}`);
    return {
      ok: false,
      step: "unknown",
      reason: `diff/rules failed: ${msg}`,
      durationMs: elapsed(),
    };
  }

  const durationMs = elapsed();
  console.log(
    `[github-app pipeline] done ${logCtx} suggestions=${suggestions.length} duration=${durationMs}ms baseSession=${baseSession.id} headSession=${headSession.id}`,
  );

  return {
    ok: true,
    baseSessionId: baseSession.id,
    headSessionId: headSession.id,
    diffSummary: diff.summary,
    suggestions,
    durationMs,
  };
}
