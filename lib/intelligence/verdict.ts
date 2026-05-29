// Verdict computation (v0.82+, Phase C).
//
// The Final Verdict is the climax of the RepoJury narrative: each
// of the four jury departments (Health, Security, Forensics, Supply)
// votes on the codebase based on the deterministic signals from
// extractHealthSignals() + the standalone security scanners on the
// snapshot. Their combined votes produce one of three outcomes:
//
//   cleared      — all four departments pass; the codebase is in
//                  good standing on the dimensions we measure
//   conditional  — at least one department flagged something, but
//                  nothing blocking; approval contingent on follow-up
//   returned     — at least one department issued a fail; the
//                  codebase has serious findings that need addressing
//
// Pure function over AnalysisSnapshot. No I/O, no AI. The AI narrative
// layer in verdictNarrative.ts grounds itself in this output, never
// adds new claims. Mirrors the trust chain established by
// lib/intelligence/healthSummary.ts → lib/healthAnalysis.ts.
//
// Why a separate file from healthSummary.ts: the six dimensions there
// are organized around DATA categories (what kind of signal is this).
// Verdict reorganizes around DECISIONS (does this codebase pass the
// jury). vulnerable-deps lives in the "deps" dimension on the Overview
// strip because it's dependency data, but the Verdict puts it under
// Security Bureau because the decision it informs is a security one.

import type { AnalysisSnapshot, HealthSignal } from "../types";
import { extractHealthSignals } from "../signals";

// ---------------- Public types ----------------

export type DepartmentId = "health" | "security" | "forensics" | "supply";

/** A single department's vote on the codebase. Three-state: pass /
 *  conditional / fail. Mirrors the dimension-status alphabet without
 *  the "unknown" state — departments always have an opinion (silence
 *  is interpreted as pass, since the things they look for didn't
 *  fire). */
export type Vote = "pass" | "conditional" | "fail";

/** The overall verdict combining all four department votes. */
export type VerdictOutcome = "cleared" | "conditional" | "returned";

export interface DepartmentRuling {
  id: DepartmentId;
  /** Full title shown in the verdict page section header. */
  title: string;
  vote: Vote;
  /** Short word for the vote chip: "Cleared", "Conditional", "Failed". */
  voteLabel: string;
  /** One-line rationale. Composed from the lead signal's detail or
   *  a fixed phrase when the department has nothing to report. */
  reason: string;
  /** The 1-3 signals that drove this department's vote, sorted with
   *  the most severe first. Used to populate the per-department
   *  evidence list on the verdict page. */
  topSignals: HealthSignal[];
  /** Total number of signals the department considered (working +
   *  needsWork + questions across its mandate). */
  signalCount: number;
  /** Best entry-route for the user to investigate further — the
   *  first tab in that department's sidebar group. Server-rendered
   *  page injects sessionId-prefixed path on its side. */
  exploreSlug: string;
}

export interface Verdict {
  outcome: VerdictOutcome;
  /** Full label: "Cleared", "Conditional Approval", "Returned for
   *  Revision". */
  outcomeLabel: string;
  /** 0-100 composite score, summed across the four departments
   *  (pass = 25, conditional = 15, fail = 5). Designed so that
   *    100  = all four pass
   *    >=85 = three pass + one conditional/fail
   *    60–80 = mixed; one or two flagged offices
   *    <50  = multiple offices failed
   *  Mirrors the score-ring + grade letter on the landing page's
   *  VerdictDoc so the brand promise survives all the way through. */
  score: number;
  /** Letter grade derived from `score`. US-school style:
   *  A / A- / B+ / B / B- / C+ / C / C- / D+ / D / F. */
  grade: string;
  /** One-sentence deterministic summary, used both as the page lead
   *  when AI is off and as grounding-input for the AI narrative when
   *  ANTHROPIC_API_KEY is set. */
  summary: string;
  rulings: DepartmentRuling[];
}

// ---------------- Department → signal map ----------------

/** Each department votes on its own slice of the 20-signal catalog.
 *  When a new detector ships in lib/signals.ts, add its ID to the
 *  department whose mandate it falls under so its evidence flows
 *  through the Verdict path automatically.
 *
 *  Mapping rationale (different from healthSummary's data-categories):
 *    - Health   = holistic vital signs (activity / team / hygiene)
 *                 + the test-presence positive signal
 *    - Security = decisions about safety: incidents, vuln deps,
 *                 dynamic-execution risk (secrets are checked
 *                 directly from snapshot.secretFindings since they
 *                 aren't HealthSignal-shaped)
 *    - Forensics = structural inspection: coupling, depth, untested
 *                  hotspots
 *    - Supply    = supply chain hygiene (excluding CVEs which go to
 *                  Security) + PR flow as a delivery-throughput proxy
 */
const DEPARTMENT_SIGNAL_IDS: Record<DepartmentId, readonly string[]> = {
  health: [
    // Activity
    "very-active",
    "stale",
    "consistent-cadence",
    "real-code-activity",
    // Team
    "solo-project",
    "bus-factor-risk",
    "broad-ownership",
    "many-contributors",
    // Hygiene
    "missing-hygiene",
    "metadata-dominance",
    // Test presence — positive signal that's primarily about
    // codebase health rather than structural forensics.
    "good-test-presence",
  ],
  security: [
    "known-incident-match",
    "vulnerable-deps",
    "risky-eval-patterns",
  ],
  forensics: [
    "untested-hotspots",
    "cross-boundary-coupling",
    "deep-dependency-chains",
  ],
  supply: [
    "outdated-deps",
    "deprecated-deps",
    "fresh-deps",
    "healthy-pr-throughput",
    "pr-backlog",
    "fast-pr-cycle",
    "slow-pr-cycle",
  ],
};

const DEPARTMENT_TITLES: Record<DepartmentId, string> = {
  health: "Health Department",
  security: "Security Bureau",
  forensics: "Forensics Lab",
  supply: "Supply Office",
};

/** First tab in each department's sidebar group — where the explore
 *  link drops the user to start their drill-down. Slugs are relative
 *  to /session/[id] and joined in the page. */
const DEPARTMENT_EXPLORE_SLUGS: Record<DepartmentId, string> = {
  health: "/insights",
  security: "/security",
  forensics: "/architecture",
  supply: "/packages",
};

const VOTE_LABELS: Record<Vote, string> = {
  pass: "Cleared",
  conditional: "Conditional",
  fail: "Failed",
};

const OUTCOME_LABELS: Record<VerdictOutcome, string> = {
  cleared: "Cleared",
  conditional: "Conditional Approval",
  returned: "Returned for Revision",
};

// ---------------- Helpers ----------------

interface MatchedSignals {
  working: HealthSignal[];
  needsWork: HealthSignal[];
  questions: HealthSignal[];
}

function matchSignals(
  ids: readonly string[],
  signals: {
    working: HealthSignal[];
    needsWork: HealthSignal[];
    questions: HealthSignal[];
  }
): MatchedSignals {
  const idSet = new Set(ids);
  return {
    working: signals.working.filter((s) => idSet.has(s.id)),
    needsWork: signals.needsWork.filter((s) => idSet.has(s.id)),
    questions: signals.questions.filter((s) => idSet.has(s.id)),
  };
}

/** Pick the top 1-3 signals for the per-department evidence list.
 *  Order: high-severity needsWork → other needsWork → questions →
 *  working. Same priority as healthSummary's pickLeadSignal, just
 *  returning more entries. */
function pickTopSignals(matched: MatchedSignals, max = 3): HealthSignal[] {
  const out: HealthSignal[] = [];
  // High-severity worst-first inside needsWork
  const highSev = matched.needsWork.filter((s) => s.severity === "high");
  const otherNeedsWork = matched.needsWork.filter(
    (s) => s.severity !== "high"
  );
  out.push(...highSev, ...otherNeedsWork);
  out.push(...matched.questions);
  out.push(...matched.working);
  return out.slice(0, max);
}

/** Compose a one-line reason from the lead signal + count context.
 *  Falls back to a fixed phrase when the department has nothing
 *  to report (clean pass). */
function composeReason(
  vote: Vote,
  lead: HealthSignal | undefined,
  matched: MatchedSignals
): string {
  if (vote === "pass") {
    if (matched.working.length > 0) {
      // Lean on the positive lead signal's title.
      return lead?.title ?? "No concerns flagged.";
    }
    return "No concerns flagged.";
  }
  // Conditional or fail — surface the lead signal's title since it's
  // already a concise human-readable phrase from signals.ts (titles
  // are 4-8 words by convention).
  return lead?.title ?? "Issues detected.";
}

// ---------------- Security-specific scoring ----------------

/** Security looks at the standalone secret-scanner findings on top
 *  of its HealthSignal mandate. Critical and high secrets escalate
 *  the vote to fail; medium keeps it at conditional. The scanner's
 *  alphabet is "critical" | "high" | "medium" — no "low" tier. */
function adjustSecurityForSecrets(
  baseVote: Vote,
  snap: AnalysisSnapshot
): Vote {
  const findings = snap.secretFindings?.findings ?? [];
  if (findings.length === 0) return baseVote;
  const escalating = findings.some(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (escalating) return "fail";
  // Medium secrets keep the vote at conditional or worse.
  if (baseVote === "pass") return "conditional";
  return baseVote;
}

/** Compute a department's vote from its matched signals. The pure-
 *  signal path; Security additionally calls adjustSecurityForSecrets
 *  to fold in the standalone scanner findings. */
function pickVote(matched: MatchedSignals): Vote {
  const hasHigh = matched.needsWork.some((s) => s.severity === "high");
  if (hasHigh) return "fail";
  if (matched.needsWork.length > 0) return "conditional";
  // Questions are observations, not problems — they don't trigger
  // conditional alone (unlike the Health-at-a-Glance dimension
  // tiles, which paint amber on questions to make sure the user
  // sees them). For the Verdict we treat them as "noted, but pass"
  // so departments don't get penalized for human-judgment items.
  return "pass";
}

// ---------------- Outcome rollup ----------------

/** Combine the four votes into one overall outcome. Any fail returns;
 *  all pass clears; otherwise conditional. */
function rollupOutcome(rulings: DepartmentRuling[]): VerdictOutcome {
  if (rulings.some((r) => r.vote === "fail")) return "returned";
  if (rulings.every((r) => r.vote === "pass")) return "cleared";
  return "conditional";
}

// ---------------- Score + grade ----------------

/** Points each vote type contributes to the composite score. Chosen
 *  so that:
 *    4 × pass         = 100  (cleared, full marks)
 *    3 × pass + cond  = 90   (still A territory, one office hedged)
 *    2 × pass + 2c    = 80   (B+ — cracks showing but stable)
 *    4 × conditional  = 60   (C — caution across the board)
 *    1 × pass + 3f    = 40   (F — one office holding the line)
 *    4 × fail         = 20   (deep F, basement floor isn't zero so
 *                            the score never reads as "no analysis
 *                            done") */
const VOTE_POINTS: Record<Vote, number> = {
  pass: 25,
  conditional: 15,
  fail: 5,
};

/** Sum the four department votes into a 0-100 composite score.
 *  Range: 20 (all fail) – 100 (all pass). The 20 floor is deliberate:
 *  a "0" would look like "no data" rather than "every office filed
 *  serious findings", which is the message we actually want to land. */
function computeScore(rulings: DepartmentRuling[]): number {
  return rulings.reduce((sum, r) => sum + VOTE_POINTS[r.vote], 0);
}

/** Map score → letter grade. Cut-points calibrated against the actual
 *  reachable score points (which come in 5-point steps since vote
 *  weights are 25/15/5), so each band corresponds to a real vote
 *  combination rather than abstract percentile thinking. */
function scoreToGrade(score: number): string {
  if (score >= 100) return "A";
  if (score >= 90) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D+";
  if (score >= 45) return "D";
  return "F";
}

/** Generate the deterministic one-sentence verdict summary. Used as
 *  the lead line when the AI narrative is unavailable and as part of
 *  the grounding payload for verdictNarrative.ts when it is. */
function composeSummary(
  outcome: VerdictOutcome,
  rulings: DepartmentRuling[]
): string {
  const fails = rulings.filter((r) => r.vote === "fail");
  const conditionals = rulings.filter((r) => r.vote === "conditional");
  const passes = rulings.filter((r) => r.vote === "pass");

  switch (outcome) {
    case "cleared":
      return `All four departments cleared this codebase — ${passes.length} units, no flagged findings.`;
    case "returned": {
      const names = fails.map((r) => r.title).join(", ");
      return `${fails.length} ${
        fails.length === 1 ? "department" : "departments"
      } returned this codebase for revision: ${names}.`;
    }
    case "conditional": {
      const names = conditionals.map((r) => r.title).join(", ");
      return `${conditionals.length} ${
        conditionals.length === 1 ? "department" : "departments"
      } granted conditional approval: ${names}.`;
    }
  }
}

// ---------------- Main entry point ----------------

const ORDER: DepartmentId[] = ["health", "security", "forensics", "supply"];

/** Pure function: snapshot → full Verdict. Always returns 4 rulings
 *  in canonical order so renderers can map index → position without
 *  having to sort. */
export function computeVerdict(snap: AnalysisSnapshot): Verdict {
  const signals = extractHealthSignals(snap);

  const rulings: DepartmentRuling[] = ORDER.map((id) => {
    const matched = matchSignals(DEPARTMENT_SIGNAL_IDS[id], signals);
    let vote = pickVote(matched);
    if (id === "security") {
      vote = adjustSecurityForSecrets(vote, snap);
    }
    const topSignals = pickTopSignals(matched);
    const lead = topSignals[0];
    const reason = composeReason(vote, lead, matched);
    const signalCount =
      matched.working.length +
      matched.needsWork.length +
      matched.questions.length;
    return {
      id,
      title: DEPARTMENT_TITLES[id],
      vote,
      voteLabel: VOTE_LABELS[vote],
      reason,
      topSignals,
      signalCount,
      exploreSlug: DEPARTMENT_EXPLORE_SLUGS[id],
    };
  });

  const outcome = rollupOutcome(rulings);
  const outcomeLabel = OUTCOME_LABELS[outcome];
  const score = computeScore(rulings);
  const grade = scoreToGrade(score);
  const summary = composeSummary(outcome, rulings);

  return { outcome, outcomeLabel, score, grade, summary, rulings };
}
