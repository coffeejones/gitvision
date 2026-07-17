// Verification-rules engine. Takes a DiffResult (+ future signal
// sources) and produces a prioritized list of "Suggested verification"
// items for the PR-bot comment — the 4th section of Format B v2.
//
// Design goals:
//
//   1. Pure function — no I/O, no LLM. Given the same diff, always
//      produces the same suggestions. The trust-anchor in the PR
//      comment is "deterministic signals, no LLM in this comment";
//      that means this engine in particular.
//
//   2. Composable rules — each rule is its own object with an id,
//      severity, and an evaluate() that emits 0..N suggestions.
//      Adding a new rule = registering one more entry in the
//      REGISTERED_RULES list. No central dispatch logic to modify.
//
//   3. Capped output — PR comments lose readers fast past 3 items.
//      Default maxResults=3. Sort by severity, then by impact score
//      within severity, with a stable tiebreaker.
//
//   4. Evidence-cited — every suggestion includes an `evidence` array
//      naming the underlying facts that triggered it. Reviewer can
//      trace back to the diff data without trusting the engine.
//
// What this v1 does NOT yet incorporate:
//   - Per-caller blast-radius signal (would let us upgrade "function
//     was removed" from warning to critical when callers exist)
//   - Test coverage delta — currently approximated by "did any test
//     file in the same module change?". Imprecise but workable for v1.
//   - Cross-module change signal — wired in once we have a path-based
//     module heuristic shared between blast-radius and this engine.

import type { DiffResult, ChangedFunction } from "./diffAware";
import { cmpStr } from "../deterministicSort";

export type Severity = "critical" | "warning" | "info";

export interface VerificationSuggestion {
  /** Rule that produced this suggestion. Lets callers filter, group,
   *  or selectively disable rules later. */
  ruleId: string;
  severity: Severity;
  /** Plain-English text suitable for inclusion in a PR-bot comment.
   *  Self-contained — does not require the reader to look at other
   *  sections of the comment. */
  text: string;
  /** Short list of facts the suggestion is grounded in. Free-form
   *  strings — meant for "as evidence: [...]" rendering in a deep-dive
   *  view, not consumed programmatically by other rules. */
  evidence: string[];
  /** Higher = more impactful within the same severity bucket. The
   *  evaluator uses this for the secondary sort. Optional — treated
   *  as 0 when absent. */
  impactScore?: number;
}

export interface VerificationContext {
  diff: DiffResult;
}

export interface VerificationRule {
  id: string;
  description: string;
  evaluate(ctx: VerificationContext): VerificationSuggestion[];
}

export interface EvaluateOptions {
  /** Cap on total suggestions returned. Default 3 — past that, PR-
   *  comment readers tune out. Set higher for deep-dive views. */
  maxResults?: number;
}

export function evaluateVerificationRules(
  ctx: VerificationContext,
  opts: EvaluateOptions = {}
): VerificationSuggestion[] {
  const maxResults = opts.maxResults ?? 3;
  const all: VerificationSuggestion[] = [];
  for (const rule of REGISTERED_RULES) {
    all.push(...rule.evaluate(ctx));
  }
  all.sort((a, b) => {
    const sd = severityRank(b.severity) - severityRank(a.severity);
    if (sd !== 0) return sd;
    const id = (b.impactScore ?? 0) - (a.impactScore ?? 0);
    if (id !== 0) return id;
    // Stable tiebreaker: ruleId, then text. Avoids non-determinism
    // when two rules produce equally-prioritized suggestions on
    // distinct functions.
    const rd = cmpStr(a.ruleId, b.ruleId);
    if (rd !== 0) return rd;
    return cmpStr(a.text, b.text);
  });
  return all.slice(0, maxResults);
}

// ---------------- helpers ----------------

function severityRank(s: Severity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

/** Detect test-files across our 8 supported language conventions.
 *  Order matters for some patterns (Java `src/test/` checked before
 *  generic Tests.java to handle test-only file moves correctly). */
export function isTestFile(filePath: string): boolean {
  // Java/Kotlin
  if (/\/src\/test\//.test(filePath)) return true;
  if (/Tests?\.java$/.test(filePath)) return true;
  if (/Tests?\.kt$/.test(filePath)) return true;
  // C#
  if (/Tests?\.cs$/.test(filePath)) return true;
  // Python
  if (/(^|\/)tests?\//.test(filePath)) return true;
  if (/(^|\/)test_[^/]+\.py$/.test(filePath)) return true;
  if (/_test\.py$/.test(filePath)) return true;
  // Go
  if (/_test\.go$/.test(filePath)) return true;
  // JS/TS
  if (/__tests?__\//.test(filePath)) return true;
  if (/\.(test|spec)\.(tsx?|jsx?|mts|cts|mjs|cjs)$/.test(filePath)) return true;
  // PHP
  if (/Test\.php$/.test(filePath)) return true;
  // Ruby
  if (/_spec\.rb$/.test(filePath)) return true;
  if (/(^|\/)spec\//.test(filePath)) return true;
  return false;
}

/** Module key — strips test/main split conventions so a production
 *  file and its test mirror end up under the same key. Used to
 *  approximate "did this change ship with tests?" by checking whether
 *  any test file in the same module was also touched.
 *
 *  Coverage of our 8 languages:
 *    Java/Kotlin: `src/main/java/owner/X.java` and
 *                 `src/test/java/owner/XTests.java` → "owner"
 *    Python:     `flask/cli.py` vs `tests/test_cli.py` → strips
 *                `tests/` prefix; doesn't yet map `flask/tests/` mirror
 *    Go:         `pkg/foo.go` vs `pkg/foo_test.go` → same dir, same key
 *    JS/TS:      `src/x.ts` vs `src/__tests__/x.test.ts` → strips
 *                `__tests__/` segment
 *    Ruby:       `lib/foo.rb` vs `spec/foo_spec.rb` → strips `spec/`
 *    C#/PHP:     same-directory convention is the typical pattern
 *
 *  Imperfect for some sub-tree mirror conventions (e.g. Java's
 *  `src/test/java/com/foo/owner/` vs `src/main/java/com/foo/owner/`),
 *  but the failure mode is "module mismatch" → we wrongly flag the
 *  change as untested. False-positive direction is acceptable for v1
 *  attention-signaling. */
export function moduleKeyOf(filePath: string): string {
  let p = filePath;
  // Java/Kotlin source/test split: src/main/<lang>/... vs src/test/<lang>/...
  p = p.replace(/^src\/(main|test)\/[^/]+\//, "");
  // JS/TS __tests__ subdir
  p = p.replace(/\/__tests__\//, "/");
  // Python leading tests/ folder
  p = p.replace(/^tests?\//, "");
  // Ruby leading spec/ folder
  p = p.replace(/^spec\//, "");
  const lastSep = p.lastIndexOf("/");
  return lastSep < 0 ? "" : p.substring(0, lastSep);
}

function moduleHasTestChange(diff: DiffResult, prodFilePath: string): boolean {
  const target = moduleKeyOf(prodFilePath);
  for (const c of diff.changes) {
    if (isTestFile(c.filePath) && moduleKeyOf(c.filePath) === target) {
      return true;
    }
  }
  return false;
}

function qualname(c: ChangedFunction): string {
  return c.containerType ? `${c.containerType}.${c.name}` : c.name;
}

// ---------------- rules ----------------

// Threshold-calibration history:
//   v1 (initial)  thresholds tuned on synthetic-test intuition
//   v2 (2026-05-14)  lowered after real-world validation against Flask
//                    3.1.2→3.1.3 and 3.0.3→3.1.0 showed zero rules
//                    fired on 109 actual changes. See eval/strategy/
//                    rule-tuning-2026-05.md for the data trail.

const complexityIncreaseWithoutTest: VerificationRule = {
  id: "complexity-increase-without-test",
  description:
    "Flags modified production functions whose cyclomatic complexity rose by 4 or more without a corresponding test-file change in the same module.",
  evaluate(ctx) {
    const out: VerificationSuggestion[] = [];
    for (const c of ctx.diff.changes) {
      if (c.status !== "modified") continue;
      if (isTestFile(c.filePath)) continue;
      const delta = c.complexityDelta ?? 0;
      if (delta < 4) continue;  // threshold: +4 or more
      if (moduleHasTestChange(ctx.diff, c.filePath)) continue;
      out.push({
        ruleId: this.id,
        severity: "critical",
        text:
          `${qualname(c)} in \`${c.filePath}\` grew by +${delta} cyclomatic ` +
          `complexity (${c.complexityBefore} → ${c.complexityAfter}). ` +
          `No tests in the same module were changed — add a regression ` +
          `test covering the new branch before merge.`,
        evidence: [
          `complexity_before=${c.complexityBefore}`,
          `complexity_after=${c.complexityAfter}`,
          `complexity_delta=${delta}`,
          `module=${moduleKeyOf(c.filePath)}`,
          `tests_changed_in_module=false`,
        ],
        impactScore: delta,
      });
    }
    return out;
  },
};

const newComplexFunctionUntested: VerificationRule = {
  id: "new-complex-function-untested",
  description:
    "Flags newly added production functions with cyclomatic complexity >= 4 when no test file in the same module was added or modified.",
  evaluate(ctx) {
    const out: VerificationSuggestion[] = [];
    for (const c of ctx.diff.changes) {
      if (c.status !== "added") continue;
      if (isTestFile(c.filePath)) continue;
      const cx = c.complexityAfter ?? 0;
      if (cx < 4) continue;
      if (moduleHasTestChange(ctx.diff, c.filePath)) continue;
      out.push({
        ruleId: this.id,
        severity: "warning",
        text:
          `New function ${qualname(c)} in \`${c.filePath}\` has cyclomatic ` +
          `complexity ${cx}. No test in this module exercises it yet — ` +
          `add coverage before merge.`,
        evidence: [
          `status=added`,
          `complexity=${cx}`,
          `module=${moduleKeyOf(c.filePath)}`,
          `tests_changed_in_module=false`,
        ],
        impactScore: cx,
      });
    }
    return out;
  },
};

const removedFunctionWithImpact: VerificationRule = {
  id: "removed-function-with-impact",
  description:
    "Flags removed functions whose pre-removal complexity was >= 2 — even simple methods are part of the API surface and may have callers.",
  evaluate(ctx) {
    const out: VerificationSuggestion[] = [];
    for (const c of ctx.diff.changes) {
      if (c.status !== "removed") continue;
      if (isTestFile(c.filePath)) continue;
      const cx = c.complexityBefore ?? 0;
      if (cx < 2) continue;
      out.push({
        ruleId: this.id,
        severity: "warning",
        text:
          `${qualname(c)} was removed from \`${c.filePath}\` (original ` +
          `complexity ${cx}). Verify no callers in this repo still depend ` +
          `on it — blast_radius can confirm.`,
        evidence: [
          `status=removed`,
          `complexity_before=${cx}`,
        ],
        impactScore: cx,
      });
    }
    return out;
  },
};

const multipleRemovalsFromContainer: VerificationRule = {
  id: "multiple-removals-from-container",
  description:
    "Fires when 3 or more functions are removed from the same class/struct/container — an API-surface change that won't be caught by per-function complexity rules when each individual removal is trivial.",
  evaluate(ctx) {
    const removalsByContainer = new Map<string, ChangedFunction[]>();
    for (const c of ctx.diff.changes) {
      if (c.status !== "removed") continue;
      if (isTestFile(c.filePath)) continue;
      if (!c.containerType) continue; // top-level removals handled by removed-function-with-impact
      const arr = removalsByContainer.get(c.containerType) ?? [];
      arr.push(c);
      removalsByContainer.set(c.containerType, arr);
    }
    const out: VerificationSuggestion[] = [];
    for (const [container, removals] of removalsByContainer) {
      if (removals.length < 3) continue;
      const names = removals.map((r) => r.name).slice(0, 5).join(", ");
      const more = removals.length > 5 ? ` (+${removals.length - 5} more)` : "";
      const filePath = removals[0].filePath; // any — they share container
      out.push({
        ruleId: this.id,
        severity: "warning",
        text:
          `${removals.length} methods were removed from \`${container}\` in ` +
          `\`${filePath}\`: ${names}${more}. This is an API-surface change ` +
          `even when individual methods are trivial — verify all callers ` +
          `across the codebase are updated.`,
        evidence: [
          `container=${container}`,
          `removals_count=${removals.length}`,
          `file=${filePath}`,
        ],
        impactScore: removals.length,
      });
    }
    return out;
  },
};

const highNetComplexityDelta: VerificationRule = {
  id: "high-net-complexity-delta",
  description:
    "Fires once when the PR's total cyclomatic complexity increased by more than 10 — invites the reviewer to consider whether the change can be split into smaller PRs.",
  evaluate(ctx) {
    const delta = ctx.diff.summary.netComplexityDelta;
    if (delta <= 10) return [];
    const modCount = ctx.diff.summary.functionsModified;
    const addCount = ctx.diff.summary.functionsAdded;
    return [
      {
        ruleId: this.id,
        severity: "info",
        text:
          `This PR adds **+${delta} cyclomatic complexity points** across ` +
          `${modCount} modified and ${addCount} added functions. Consider ` +
          `whether the increase is justified or whether the change can be ` +
          `split into smaller reviewable PRs.`,
        evidence: [
          `net_complexity_delta=${delta}`,
          `functions_modified=${modCount}`,
          `functions_added=${addCount}`,
        ],
        impactScore: delta,
      },
    ];
  },
};

const largePrOverview: VerificationRule = {
  id: "large-pr-overview",
  description:
    "Fires when a PR touches more than 10 files. Surfaces scope context (info-severity, sorts below critical/warning) — useful when otherwise-quiet rules leave the reviewer thinking 'wait, is this PR big or small?'.",
  evaluate(ctx) {
    const files = ctx.diff.summary.filesChanged;
    if (files <= 10) return [];
    const total =
      ctx.diff.summary.functionsAdded +
      ctx.diff.summary.functionsRemoved +
      ctx.diff.summary.functionsModified;
    return [
      {
        ruleId: this.id,
        severity: "info",
        text:
          `Sizeable PR — touches **${files} files** with ${total} function-` +
          `level changes (${ctx.diff.summary.functionsAdded} added, ` +
          `${ctx.diff.summary.functionsRemoved} removed, ` +
          `${ctx.diff.summary.functionsModified} modified). Worth a ` +
          `holistic read; not just patch-by-patch review.`,
        evidence: [
          `files_changed=${files}`,
          `functions_added=${ctx.diff.summary.functionsAdded}`,
          `functions_removed=${ctx.diff.summary.functionsRemoved}`,
          `functions_modified=${ctx.diff.summary.functionsModified}`,
        ],
        impactScore: files,
      },
    ];
  },
};

const REGISTERED_RULES: VerificationRule[] = [
  complexityIncreaseWithoutTest,
  newComplexFunctionUntested,
  removedFunctionWithImpact,
  multipleRemovalsFromContainer,
  highNetComplexityDelta,
  largePrOverview,
];

/** Export the rules array for testing — lets tests verify the registry
 *  shape without relying on internal-state inspection. */
export function registeredRules(): readonly VerificationRule[] {
  return REGISTERED_RULES;
}
