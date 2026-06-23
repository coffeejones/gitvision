// Actionable recommendations — the advisory layer on top of the deterministic
// signals.
//
// The market's sharpest critique of the analysis was that it *diagnoses* more
// than it *advises*: it surfaces "X% of hot files are untested" but stops short
// of "here's what to do, and why it matters for THIS repo". This module closes
// that gap.
//
// Three invariants, inherited from the rest of the codebase:
//
//   1. GROUNDED. Every recommendation is derived from a computed HealthSignal
//      and carries that signal's id (`signalId`) for traceability. We never
//      invent advice that isn't backed by a measured signal — same zero-
//      hallucination contract the AI narrative honors. The AI layer (a later
//      step) only rephrases these computed recommendations; it never adds new
//      ones.
//
//   2. REPO-SPECIFIC. Each recommendation reuses the source signal's evidence
//      (the actual file paths, counts, percentages) so the advice names real
//      files and real numbers — "split src/app.ts (800 lines, untested,
//      changes weekly)" — not a generic best-practice lecture.
//
//   3. LANGUAGE-AGNOSTIC. Rules are keyed by signal id in a registry, never by
//      language. Adding support for a new language touches the signal/plugin
//      layer, never this file. Adding a recommendation for a new signal is a
//      one-entry addition to RULES — no central branching to edit.
//
// Working ("things going well") signals get NO recommendation by design — this
// layer answers "what to fix", and a clean repo honestly returns nothing rather
// than manufacturing busywork.

import { extractHealthSignals } from "./signals";
import type { AnalysisSnapshot, HealthSignal, HealthSignals } from "./types";

/** The product dimension a recommendation belongs to — drives grouping + icon
 *  choice in the UI, and the intrinsic-importance weight in prioritization. */
export type RecommendationCategory =
  | "security"
  | "dependencies"
  | "tests"
  | "architecture"
  | "process"
  | "activity"
  | "docs";

/** Rough cost-to-act, so the UI can surface quick wins separately from
 *  substantial efforts (impact-vs-effort is how people actually prioritize). */
export type RecommendationEffort = "quick" | "moderate" | "substantial";

export interface Recommendation {
  /** Stable id, derived from the source signal id. */
  id: string;
  /** The HealthSignal this recommendation is grounded in — traceability so the
   *  UI (and the AI narrative) can point back to the evidence. */
  signalId: string;
  /** Imperative headline — "Add tests to your hottest files". */
  title: string;
  /** The concrete, repo-specific thing to do, naming real files/numbers. */
  action: string;
  /** Why it matters, tied to this repo's actual situation. */
  why: string;
  category: RecommendationCategory;
  /** Carried from the source signal where present (needsWork signals). */
  severity?: "low" | "medium" | "high";
  effort: RecommendationEffort;
  /** Higher = do sooner. Composite of signal severity + category importance.
   *  Exposed (not just used for sorting) so the UI can band it if it wants. */
  priority: number;
  /** The grounding evidence, carried verbatim from the source signal. */
  evidence: HealthSignal["evidence"];
}

export interface Recommendations {
  /** All recommendations, sorted by priority (highest first). */
  items: Recommendation[];
  /** The highest-priority few — the "do this first" shortlist. */
  topActions: Recommendation[];
}

/** Default size of the "do this first" shortlist. */
export const DEFAULT_TOP_ACTIONS = 5;

// ------------------- Prioritization -------------------

// Severity dominates priority (a high-severity issue always outranks a
// medium one), with the rule's category weight as the within-severity
// tiebreaker. Signals without a severity (the softer "questions" bucket) sit
// just below "medium" so real debt always leads the soft nudges.
const SEVERITY_WEIGHT: Record<NonNullable<HealthSignal["severity"]>, number> = {
  high: 100,
  medium: 60,
  low: 30,
};
const NO_SEVERITY_WEIGHT = 20;

function priorityFor(signal: HealthSignal, rule: Rule): number {
  const sev = signal.severity
    ? SEVERITY_WEIGHT[signal.severity]
    : NO_SEVERITY_WEIGHT;
  return sev + rule.baseWeight;
}

// ------------------- Evidence accessors (defensive) -------------------

function pathsOf(signal: HealthSignal): string[] {
  return signal.evidence.paths ?? [];
}
function numOf(signal: HealthSignal, key: string): number | undefined {
  return signal.evidence.numbers?.[key];
}
/** Join the first `n` evidence paths for inline prose; "" if none. */
function firstPaths(signal: HealthSignal, n: number, sep = ", "): string {
  return pathsOf(signal).slice(0, n).join(sep);
}

// ------------------- Rule registry (one entry per signal id) -------------------

interface Built {
  title: string;
  action: string;
  why: string;
}

interface Rule {
  category: RecommendationCategory;
  effort: RecommendationEffort;
  /** Intrinsic importance of this category, added to the severity weight.
   *  Security > dependencies/tests > architecture/process > activity/docs. */
  baseWeight: number;
  /** Build the repo-specific copy from the signal's evidence. Returns null to
   *  decline (e.g. evidence too thin to say anything concrete) — the engine
   *  then emits no recommendation for that signal rather than a vague one. */
  build: (signal: HealthSignal, snap: AnalysisSnapshot) => Built | null;
}

const RULES: Record<string, Rule> = {
  // ---- Security (most urgent) ----
  "known-incident-match": {
    category: "security",
    effort: "quick",
    baseWeight: 28,
    build: (s) => {
      const packages = numOf(s, "packages") ?? pathsOf(s).length;
      const eg = firstPaths(s, 2);
      return {
        title: "Verify possible supply-chain matches",
        action: `${packages} dependenc${packages === 1 ? "y matches a version" : "ies match versions"} flagged in documented supply-chain incidents${eg ? ` — e.g. ${eg}` : ""}. Check each against the linked advisory and, if confirmed, pin to a safe version or remove it.`,
        why: "These versions match release strings flagged in documented supply-chain attacks — it's a match by version string, not proof on its own. But if one is confirmed, that release may have run malicious code on install, so it's worth ruling out before anything else.",
      };
    },
  },
  "vulnerable-deps": {
    category: "security",
    effort: "moderate",
    baseWeight: 25,
    build: (s) => {
      const packages = numOf(s, "packages") ?? pathsOf(s).length;
      const cves = numOf(s, "cves");
      const eg = firstPaths(s, 2, "; ");
      return {
        title: "Patch your vulnerable dependencies",
        action: `${packages} runtime dependenc${packages === 1 ? "y has a known CVE" : "ies have known CVEs"}${cves && cves > packages ? ` (${cves} in total)` : ""}. Upgrade ${packages === 1 ? "it" : "these"} first${eg ? `: ${eg}` : ""}.`,
        why: "A known CVE in a runtime dependency is a published, attacker-known weakness reachable wherever this code runs in production. Patch it first — a CVE is the upper bound on risk, not proof it's exploitable in your usage.",
      };
    },
  },
  "risky-eval-patterns": {
    category: "security",
    effort: "moderate",
    baseWeight: 18,
    build: (s) => {
      const occurrences = numOf(s, "occurrences") ?? pathsOf(s).length;
      const files = numOf(s, "files");
      const eg = firstPaths(s, 2);
      return {
        title: "Review your dynamic-execution call sites",
        action: `${occurrences} use${occurrences === 1 ? "" : "s"} of eval / new Function / exec${files ? ` across ${files} file${files === 1 ? "" : "s"}` : ""}${eg ? ` (e.g. ${eg})` : ""}. Confirm every input reaching them is trusted, or replace them with a safer construct.`,
        why: "These execute strings as code at runtime — if any input is attacker-controllable, it's a direct code-execution hole.",
      };
    },
  },

  // ---- Dependencies ----
  "deprecated-deps": {
    category: "dependencies",
    effort: "moderate",
    baseWeight: 15,
    build: (s) => {
      const count = numOf(s, "count") ?? pathsOf(s).length;
      const eg = firstPaths(s, 2, "; ");
      return {
        title: "Replace your deprecated dependencies",
        action: `${count} runtime dependenc${count === 1 ? "y is" : "ies are"} explicitly flagged as deprecated upstream. Find maintained alternatives${eg ? `, starting with: ${eg}` : ""}.`,
        why: "Deprecated packages stop receiving fixes — including security fixes — so the cost of staying on them only grows.",
      };
    },
  },
  "outdated-deps": {
    category: "dependencies",
    effort: "moderate",
    baseWeight: 14,
    build: (s) => {
      const behind = numOf(s, "behind");
      const eg = firstPaths(s, 2, "; ");
      return {
        title: "Schedule a dependency-upgrade pass",
        action: `${behind ?? "Several"} runtime packages are a year or more behind. Group the patch and minor bumps together, but give each major-version jump its own PR behind a green test run — start with the stalest${eg ? `: ${eg}` : ""}.`,
        why: "The longer an upgrade waits, the bigger the jump — version gaps widen, migration notes pile up, and you drift off the security-patch track.",
      };
    },
  },

  // ---- Tests ----
  "untested-hotspots": {
    category: "tests",
    effort: "substantial",
    baseWeight: 15,
    build: (s) => {
      const pct = numOf(s, "pctUntested");
      const eg = firstPaths(s, 2, " and ");
      return {
        title: "Add tests to your hottest untested files",
        action: `${pct ? `${pct}% of ` : ""}your highest-churn files have no discoverable test. Start with ${eg || "the top-churn files"} — they change most, so tests there pay back fastest.`,
        why: "Hot files change constantly, so they're where regressions are most likely to be introduced — and where a single test prevents the most future breakage per line written.",
      };
    },
  },

  // ---- Architecture ----
  "cross-boundary-coupling": {
    category: "architecture",
    effort: "substantial",
    baseWeight: 10,
    build: (s) => {
      const pairs = numOf(s, "pairs");
      const p = pathsOf(s);
      const eg = p.length >= 2 ? `${p[0]} ↔ ${p[1]}` : "";
      return {
        title: "Decouple modules that change together",
        action: `${pairs ?? "Several"} file pairs in different top-level folders keep changing together${eg ? ` (e.g. ${eg})` : ""}. Introduce an interface or move the shared logic so a change in one no longer forces a change in the other.`,
        why: "Tight cross-folder coupling means your module boundaries are leaking — edits ripple wider than they should, raising the cost of every future change.",
      };
    },
  },
  "deep-dependency-chains": {
    category: "architecture",
    effort: "substantial",
    baseWeight: 9,
    build: (s) => {
      const depth = numOf(s, "maxDepth");
      const chain = pathsOf(s);
      const ends =
        chain.length >= 2 ? ` (${chain[0]} → … → ${chain[chain.length - 1]})` : "";
      return {
        title: "Shorten your deepest import chains",
        action: `Your deepest import chain runs ${depth ?? "many"} levels${ends}. Look for a link that's doing too much and split it, or invert a dependency — depend on an interface, not the concrete module — rather than just hoisting the shared file upward, which can turn it into a god-module everything imports.`,
        why: "Long chains mean a change in any link forces a re-check of everything that transitively imports it — a wide blast radius for small edits.",
      };
    },
  },

  // ---- Process ----
  "bus-factor-risk": {
    category: "process",
    effort: "substantial",
    baseWeight: 12,
    build: (s) => {
      const folders = firstPaths(s, 3);
      return {
        title: "Spread ownership of single-maintainer areas",
        action: `${folders ? `These folders are maintained by a single person: ${folders}. ` : "Some active areas have a single maintainer. "}Pair on them, or run walkthrough reviews, so at least one more person can safely change each.`,
        why: "If that one person is unavailable, work in these areas stalls — and nobody else can confidently touch the code.",
      };
    },
  },
  "pr-backlog": {
    category: "process",
    effort: "moderate",
    baseWeight: 10,
    build: (s) => {
      const open = numOf(s, "open");
      const merged = numOf(s, "merged");
      return {
        title: "Clear your PR backlog",
        action: `${open ?? "Several"} human-authored PRs are open against ${merged ?? "a few"} recently merged. Triage oldest-first: close what's stale and get a reviewer assigned to the rest.`,
        why: "Review — not coding — is the bottleneck here. Every extra day a PR waits is context the author must reload, plus merge conflicts that compound.",
      };
    },
  },
  "slow-pr-cycle": {
    category: "process",
    effort: "moderate",
    baseWeight: 10,
    build: (s) => {
      const days = numOf(s, "medianDays");
      // Round to whole days to match the signal's humanized phrasing (it
      // renders "15 days", not the raw 14.6) — two surfaces, one number.
      const daysText = days != null ? Math.round(days) : "many";
      return {
        title: "Tighten your review turnaround",
        action: `PRs take a median of ${daysText} days to merge. Set a first-response SLA (e.g. within a day) and split large PRs into smaller, reviewable pieces.`,
        why: "Slow reviews kill momentum and quietly push people toward merging without proper review just to avoid the wait.",
      };
    },
  },
  "solo-project": {
    category: "process",
    effort: "moderate",
    baseWeight: 6,
    build: (s) => {
      const author = s.evidence.note;
      return {
        title: "Reduce single-maintainer risk",
        action: `${author ? `All visible work is by @${author}. ` : ""}If you want this to outlive your own attention, document setup and architecture, and invite a second pair of eyes.`,
        why: "Perfectly fine for a personal project — but the moment others depend on it, a bus factor of one is fragile.",
      };
    },
  },

  // ---- Activity ----
  stale: {
    category: "activity",
    effort: "quick",
    baseWeight: 8,
    build: (s) => {
      const days = numOf(s, "daysSinceLastCommit");
      return {
        title: "Signal the project's status",
        action: `No commits in ${days ?? "a long while"} days. If it's finished, say so (archive it, or note "stable/maintenance" in the README); if it's paused, a one-line roadmap note tells visitors what to expect.`,
        why: "Visitors can't tell \"done\" from \"abandoned\" on their own — an explicit status sets expectations and protects the project's reputation.",
      };
    },
  },
  "metadata-dominance": {
    category: "activity",
    effort: "quick",
    baseWeight: 4,
    build: (s) => {
      const pct = numOf(s, "metadataPct");
      return {
        title: "Check where the real work is happening",
        action: `${pct ? `${pct}% of ` : "Most of "}recent churn is lockfiles, config, and release artifacts. If you expected feature work, confirm it hasn't stalled; if this is maintenance mode, no action needed.`,
        why: "Heavy metadata churn can mask a project that has quietly stopped moving forward — worth a quick glance to be sure.",
      };
    },
  },

  // ---- Docs ----
  "missing-hygiene": {
    category: "docs",
    effort: "quick",
    baseWeight: 5,
    build: (s) => {
      const missing = s.evidence.note ?? "a LICENSE and README";
      return {
        title: `Add the basics: ${missing}`,
        action: `Add ${missing}. A LICENSE tells people what they're allowed to do with the code; a README tells them what it is and how to run it.`,
        why: "Without them, most developers won't evaluate — let alone adopt — the project.",
      };
    },
  },
};

// ------------------- Engine -------------------

/** Build the recommendation for a single signal, or null if no rule covers it
 *  (working signals, or a rule that declined on thin evidence). */
function recommendationFor(
  signal: HealthSignal,
  snap: AnalysisSnapshot
): Recommendation | null {
  const rule = RULES[signal.id];
  if (!rule) return null;
  const built = rule.build(signal, snap);
  if (!built) return null;
  return {
    id: `rec-${signal.id}`,
    signalId: signal.id,
    title: built.title,
    action: built.action,
    why: built.why,
    category: rule.category,
    severity: signal.severity,
    effort: rule.effort,
    priority: priorityFor(signal, rule),
    evidence: signal.evidence,
  };
}

/** Pure core: turn computed signals into prioritized recommendations. Draws
 *  only from `needsWork` + `questions` (the actionable buckets); `working` is
 *  intentionally ignored. Pass `snap` through so rules can reach for extra
 *  context, though most read only the signal's own evidence. */
export function recommendationsFromSignals(
  signals: HealthSignals,
  snap: AnalysisSnapshot,
  topN: number = DEFAULT_TOP_ACTIONS
): Recommendations {
  const items = [...signals.needsWork, ...signals.questions]
    .map((sig) => recommendationFor(sig, snap))
    .filter((r): r is Recommendation => r !== null)
    // Highest priority first; stable tiebreak on signalId so output is
    // deterministic (matters for tests + a stable UI ordering).
    .sort(
      (a, b) =>
        b.priority - a.priority || a.signalId.localeCompare(b.signalId)
    );

  return { items, topActions: items.slice(0, Math.max(0, topN)) };
}

/** Convenience entry point: extract signals from a snapshot, then derive
 *  recommendations. Use recommendationsFromSignals directly when the caller
 *  already has the signals (avoids recomputing them). */
export function generateRecommendations(
  snap: AnalysisSnapshot,
  topN: number = DEFAULT_TOP_ACTIONS
): Recommendations {
  return recommendationsFromSignals(extractHealthSignals(snap), snap, topN);
}
