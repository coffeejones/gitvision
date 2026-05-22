// PR-comment markdown renderer.
//
// Pure function over a PipelineResult. The "thin" v1 comment format
// from eval/strategy/github-app-skeleton-2026-05.md — diff summary +
// top suggestions + footer. No blast-radius / untested-hotspots
// integration yet (that's v1.1 work).
//
// Returns null when the pipeline failed so the caller knows to skip
// posting. We don't post "couldn't analyze" comments in v1 — silent
// failure is better than noisy failure for a hobby-velocity launch.

import type { DiffSummary } from "../codeAnalysis/diffAware";
import type {
  Severity,
  VerificationSuggestion,
} from "../codeAnalysis/verificationRules";
import type { PipelineResult } from "./pipeline";

/**
 * Invisible HTML comment we embed at the top of every PR comment we
 * post. The comment poster (Commit 6) scans existing comments for this
 * marker to decide whether to create a new one or edit-in-place.
 *
 * Versioned (v1) so we can change format later without losing the
 * find-or-update path — older comments with v1 marker keep getting
 * updated; a new format would be v2 and not match v1 comments.
 */
export const COMMENT_MARKER = "<!-- repobaron:pr-review v2 -->";

export interface FormatContext {
  /** Base URL of the workspace (e.g. "https://repobaron.com"). Used
   *  to build the "Full analysis" link. Trailing slash is normalized. */
  workspaceBaseUrl: string;
}

/**
 * Render a markdown comment for a finished pipeline result.
 *
 * Returns null when:
 *   - The pipeline failed (don't post broken comments)
 *
 * Returns a string when:
 *   - 0 suggestions (positive empty-state "nothing notable")
 *   - 1+ suggestions (top-3 cap is enforced by the pipeline already)
 */
export function formatPrComment(
  result: PipelineResult,
  ctx: FormatContext,
): string | null {
  if (!result.ok) return null;

  const baseUrl = ctx.workspaceBaseUrl.replace(/\/+$/, "");
  const analysisLink = `${baseUrl}/session/${result.headSessionId}`;
  const diffLine = `**Diff summary:** ${renderDiffSummary(result.diffSummary)}`;

  let body: string;
  if (result.suggestions.length === 0) {
    body = [
      "## RepoBaron Review",
      "",
      diffLine,
      "",
      "Nothing notable on this PR ✅ — no critical/warning signals fired from our rules engine.",
    ].join("\n");
  } else {
    const lines: string[] = [
      "## RepoBaron Review",
      "",
      diffLine,
      "",
      `### Suggested verification (top ${result.suggestions.length})`,
      "",
    ];
    result.suggestions.forEach((s, i) => {
      lines.push(renderSuggestion(s, i));
    });
    body = lines.join("\n");
  }

  const footer = [
    "",
    "---",
    `[Full analysis ↗](${analysisLink}) · _Signals computed deterministically — no LLM in this comment_`,
  ].join("\n");

  return `${COMMENT_MARKER}\n${body}${footer}\n`;
}

// ---------- helpers ----------

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🟢",
};

function renderSuggestion(
  s: VerificationSuggestion,
  idx: number,
): string {
  const emoji = SEVERITY_EMOJI[s.severity];
  const label = s.severity.toUpperCase();
  return `${idx + 1}. ${emoji} **${label}** — ${s.text}`;
}

function renderDiffSummary(s: DiffSummary): string {
  // Build parts that always show; omit per-bucket counts that are zero
  // to keep the line scannable. The "files changed" count and net
  // complexity always render — they're the headline numbers.
  const parts: string[] = [];

  parts.push(plural(s.filesChanged, "file changed", "files changed"));

  const fnParts: string[] = [];
  if (s.functionsAdded > 0)
    fnParts.push(`${s.functionsAdded} added`);
  if (s.functionsRemoved > 0)
    fnParts.push(`${s.functionsRemoved} removed`);
  if (s.functionsModified > 0)
    fnParts.push(`${s.functionsModified} modified`);

  if (fnParts.length > 0) {
    parts.push(`functions: ${fnParts.join(", ")}`);
  }

  if (s.netComplexityDelta !== 0) {
    const sign = s.netComplexityDelta > 0 ? "+" : "";
    parts.push(`net complexity ${sign}${s.netComplexityDelta}`);
  }

  return parts.join(" · ");
}

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
