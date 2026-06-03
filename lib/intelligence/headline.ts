// Headline-finding picker for the session Overview page (v0.57 / A1,
// extended v0.61 / B1 with secret-leak override).
//
// Goal: surface ONE concrete actionable signal per session as the
// "above the fold" headline. Drives the 30-second rule from r/devtools
// feedback — if a visitor can't see impact in 30s, they bounce. The
// headline is the impact.
//
// Priority is a waterfall: first matching condition wins. Earlier
// rules represent more severe / more actionable findings; later rules
// fall through to neutral / informational headlines.
//
// Design:
//   0. Secret leak (v0.61)    — credentials detected; trumps everything
//   1. Critical duplicates    — high-complexity duplicate groups
//   2. Many untested hotspots — concrete actionable signal
//   3. Low coverage           — broader test-debt observation
//   4. High-churn hotspot     — architectural friction marker
//   5. Stale repo             — informational, not alarming
//   6. Generic healthy        — fallback for clean repos
//   7. No data                — fallback when codeGraph missing
//
// Each rule produces a `Headline` with:
//   - severity (critical / warning / info) → color-coded UI
//   - primary text (one line, scannable)
//   - detail text (one short sentence of context)
//   - optional CTA link to drill into the signal
//
// Pure function: easy to unit-test, easy to call server-side (no
// browser deps), no AI calls (deterministic).

import { findDuplicateGroups } from "../codeAnalysis/duplicates";
import { computeTestCoverage } from "../codeAnalysis/testCoverage";
import { isCodeFile } from "../signals";
import type { AnalysisSnapshot } from "../types";

export type HeadlineSeverity = "critical" | "warning" | "info";

export type HeadlineKind =
  | "secret-leak"
  | "critical-duplicates"
  | "many-untested-hotspots"
  | "low-coverage"
  | "high-churn-hotspot"
  | "stale-repo"
  | "generic-healthy"
  | "no-data";

export interface Headline {
  /** Which rule matched. Useful for tests + analytics later. */
  kind: HeadlineKind;
  /** Visual severity — drives color-coding in the UI. */
  severity: HeadlineSeverity;
  /** One-line headline text. ~70 chars. */
  primary: string;
  /** Detail / context, one short sentence. ~120 chars. */
  detail: string;
  /** Optional drill-down link relative to the session base URL
   *  (e.g. "code?focus=untested"). Concatenated with
   *  `/session/{id}/` by the renderer. */
  ctaLink?: string;
  /** Action label for the CTA. Skipped when ctaLink is undefined. */
  ctaLabel?: string;
}

// ---------------- Tunable thresholds ----------------

/** A duplicate group is "critical" when its hottest member has
 *  cyclomatic complexity ≥ this. High-complexity duplicates are the
 *  highest-leverage refactor candidates. Below this, duplicates exist
 *  but the cost-benefit of extraction is murkier. */
const CRITICAL_DUPLICATE_COMPLEXITY = 50;

/** "Many" untested hotspots = at least this count. Below this, the
 *  signal is too small to lead with — could fall through to coverage
 *  or generic-healthy. */
const MANY_UNTESTED_THRESHOLD = 5;

/** Top untested hotspot must have at least this much cyclomatic
 *  complexity for rule 2 to fire. Without this floor, a repo full of
 *  complexity-1 trivial getters would always lead with "5 untested
 *  hotspots" — which is noise. With it, rule 2 needs at least one
 *  meaningfully complex untested fn, and broad shallow test-debt falls
 *  through to rule 3 (low-coverage). */
const UNTESTED_TOP_COMPLEXITY_FLOOR = 3;

/** Coverage % below this is "low" enough to lead with. Above this,
 *  coverage is decent and we'd rather lead with concrete missed
 *  hotspots if any exist. */
const LOW_COVERAGE_PCT = 30;

/** Need at least this many production functions before "low coverage"
 *  is a meaningful signal — small repos can have <30% coverage that's
 *  totally fine. */
const COVERAGE_MIN_PROD_FUNCTIONS = 20;

/** A hotspot is "high churn" at this many commits or above. Below this,
 *  most active files cross the threshold and the signal is noisy. */
const HIGH_CHURN_THRESHOLD = 50;

/** Days since last commit before we surface "stale" as the headline.
 *  Below this, the repo is active enough that a stale-headline would
 *  be misleading. */
const STALE_DAYS = 90;

// ---------------- Picker ----------------

export function pickHeadline(snap: AnalysisSnapshot): Headline {
  const cg = snap.codeGraph;

  // 0a. Secret leak (v0.61) — credentials in source trump every other
  // signal. A high-confidence high/critical finding turns into the
  // page's loudest banner with a direct CTA to the rotation list.
  // Medium-only findings don't trigger the override (those are often
  // legitimate JWTs / public claims and shouldn't dominate).
  const secrets = snap.secretFindings;
  if (secrets) {
    const seriousFindings = secrets.findings.filter(
      (f) => f.severity === "critical" || f.severity === "high"
    );
    if (seriousFindings.length > 0) {
      const top = seriousFindings[0];
      const word = seriousFindings.length === 1 ? "secret" : "secrets";
      return {
        kind: "secret-leak",
        severity: "critical",
        primary: `${seriousFindings.length} possible ${word} detected — top match: ${top.patternLabel}`,
        detail: `${top.filePath}:${top.line} (${top.preview}). Rotate the credential and purge it from git history. Low-confidence test fixtures already filtered out.`,
        // Fragment anchor — SecretFindingsPanel renders an id="secrets"
        // wrapper on the Overview so this scrolls into view. We don't
        // route to a separate page; the panel lives below the headline.
        ctaLink: "#secrets",
        ctaLabel: "View possible secrets",
      };
    }
  }

  // 0b. Without a codeGraph, most signals aren't computable. Surface
  // an honest "no data" rather than guessing.
  if (!cg) {
    return {
      kind: "no-data",
      severity: "info",
      primary: "Code analysis not available for this snapshot",
      detail:
        "Refresh this session to populate the code graph — blast radius, duplicates, and hotspots will surface afterward.",
    };
  }

  // 1. Critical duplicates — high-complexity duplicate groups.
  const duplicateGroups = findDuplicateGroups(cg);
  const criticalGroup = duplicateGroups.find(
    (g) => g.maxComplexity >= CRITICAL_DUPLICATE_COMPLEXITY
  );
  if (criticalGroup) {
    const first = criticalGroup.members[0];
    const fnName = first.containerType
      ? `${first.containerType}.${first.name}`
      : first.name;
    return {
      kind: "critical-duplicates",
      severity: "critical",
      primary: `${duplicateGroups.length} duplicate group${duplicateGroups.length === 1 ? "" : "s"} found — ${criticalGroup.members.length}× copies of ${fnName}`,
      detail: `Cyclomatic ${criticalGroup.maxComplexity} per copy. Extracting a shared helper would meaningfully reduce maintenance load.`,
      ctaLink: "code?focus=duplicates",
      ctaLabel: "View near-duplicates",
    };
  }

  // 2. Many untested hotspots — concrete actionable signal.
  const coverage = computeTestCoverage(cg);
  if (
    coverage.totals.testFiles > 0 &&
    coverage.untestedHotspots.length >= MANY_UNTESTED_THRESHOLD &&
    (coverage.untestedHotspots[0]?.complexity ?? 0) >=
      UNTESTED_TOP_COMPLEXITY_FLOOR
  ) {
    const top = coverage.untestedHotspots[0];
    const fnName = top.containerType
      ? `${top.containerType}.${top.name}`
      : top.name;
    return {
      kind: "many-untested-hotspots",
      severity: "warning",
      primary: `${coverage.untestedHotspots.length} untested hotspots — most complex is ${fnName}`,
      detail: `Cyclomatic ${top.complexity} in ${top.filePath}. No test file calls this function directly.`,
      ctaLink: "code?focus=untested",
      ctaLabel: "View untested hotspots",
    };
  }

  // 3. Low coverage — broader test-debt observation.
  const coveragePct =
    coverage.totals.prodFunctions > 0
      ? Math.round(
          (coverage.totals.testedProdFunctions / coverage.totals.prodFunctions) *
            100
        )
      : 0;
  if (
    coverage.totals.testFiles > 0 &&
    coverage.totals.prodFunctions >= COVERAGE_MIN_PROD_FUNCTIONS &&
    coveragePct < LOW_COVERAGE_PCT
  ) {
    const uncovered =
      coverage.totals.prodFunctions - coverage.totals.testedProdFunctions;
    return {
      kind: "low-coverage",
      severity: "warning",
      primary: `${coveragePct}% prod fns have a direct test caller — ${uncovered} don't`,
      detail: `Test files: ${coverage.totals.testFiles}. Most production code isn't reached by any visible test path.`,
      ctaLink: "code?focus=untested",
      ctaLabel: "Explore coverage",
    };
  }

  // 4. High-churn hotspot — architectural friction marker. Restrict to CODE
  //    files: a CHANGES.rst / docs page churning every release is expected,
  //    not a god-file, and leading with it reads as a false alarm. Pick the
  //    most-changed code file so the "most-changed" claim matches the data
  //    (raw churn) rather than the hotspot score ordering.
  const topCodeHotspot = [...(snap.hotspots ?? [])]
    .filter((h) => isCodeFile(h.path))
    .sort((a, b) => b.churn - a.churn)[0];
  if (topCodeHotspot && topCodeHotspot.churn >= HIGH_CHURN_THRESHOLD) {
    return {
      kind: "high-churn-hotspot",
      severity: "warning",
      primary: `${topCodeHotspot.path} is the most-changed code file`,
      detail: `${topCodeHotspot.churn} commits across ${topCodeHotspot.authors} author${topCodeHotspot.authors === 1 ? "" : "s"}. High churn often signals architectural friction or a god-file pattern.`,
      ctaLink: "canvas",
      ctaLabel: "View on canvas",
    };
  }

  // 5. Stale repo — informational, not alarming.
  const lastCommitMs = snap.recentCommits?.[0]?.date
    ? Date.now() - new Date(snap.recentCommits[0].date).getTime()
    : 0;
  const staleMs = STALE_DAYS * 24 * 3600 * 1000;
  if (lastCommitMs > staleMs) {
    const days = Math.floor(lastCommitMs / (24 * 3600 * 1000));
    return {
      kind: "stale-repo",
      severity: "info",
      primary: `Last commit was ${days} days ago`,
      detail:
        "This repo has been quiet for a while. Everything below reflects its state at the most recent activity.",
    };
  }

  // 6. Generic healthy — fallback when no concrete signal stands out.
  const astLanguages = Object.keys(cg.byPlugin || {}).filter(
    (p) => p !== "regex-fallback" && (cg.byPlugin[p]?.files ?? 0) > 0
  ).length;
  return {
    kind: "generic-healthy",
    severity: "info",
    primary: `${cg.functions.length.toLocaleString()} functions analyzed across ${astLanguages} language${astLanguages === 1 ? "" : "s"}`,
    detail:
      "No critical signals stand out — repo looks healthy at first pass. Browse the workspace to dig deeper.",
    ctaLink: "code",
    ctaLabel: "Explore the code",
  };
}
