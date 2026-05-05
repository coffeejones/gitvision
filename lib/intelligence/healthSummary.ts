// Traffic-light health summary for the session Overview (v0.59 / A3).
//
// Maps the 21 deterministic signals from extractHealthSignals() into 6
// dimensions with one of 4 statuses each:
//
//   critical  red    high-severity needsWork in this dimension
//   warning   amber  low/medium needsWork OR meaningful questions
//   healthy   green  positive working signal, no concerns
//   unknown   gray   no signal in this dimension fired
//
// Special-case "solo" status for the team dimension when solo-project is
// the only signal — solo isn't a problem, it's just informational, and
// painting it amber would mislead.
//
// Pure function over AnalysisSnapshot. No I/O, no AI. Reuses
// extractHealthSignals() so the trust chain is preserved: every status
// derives from a deterministic signal that the user can drill into via
// the Insights page.

import type { AnalysisSnapshot, HealthSignal } from "../types";
import { extractHealthSignals } from "../signals";

export type DimensionId =
  | "activity"
  | "team"
  | "code"
  | "pr-flow"
  | "deps"
  | "hygiene";

export type DimensionStatus =
  | "critical"
  | "warning"
  | "healthy"
  | "solo"
  | "unknown";

export interface DimensionSummary {
  id: DimensionId;
  /** Display label for the dimension tile. */
  label: string;
  status: DimensionStatus;
  /** Status word: "Healthy", "Needs work", "Critical", "Solo", "Unknown". */
  statusLabel: string;
  /** Optional one-line detail ("3 CVEs", "Stale 4 months"). Empty when
   *  there's nothing concrete to add. */
  detail?: string;
  /** Number of signals that contributed to this dimension's status — useful
   *  for "view 4 evidence items" type CTAs in the Insights page. */
  signalCount: number;
}

// ---------------- Dimension → signal id map ----------------

/** Each dimension owns a set of signal IDs. extractHealthSignals() emits
 *  exactly these IDs (verified by signals.test.ts and our unit tests for
 *  this module). When a new detector ships in lib/signals.ts, add its
 *  ID here so its evidence flows into the right dimension tile. */
const DIMENSION_SIGNAL_IDS: Record<DimensionId, readonly string[]> = {
  activity: [
    "very-active",
    "stale",
    "consistent-cadence",
    "real-code-activity",
  ],
  team: [
    "solo-project",
    "bus-factor-risk",
    "broad-ownership",
    "many-contributors",
  ],
  code: [
    "untested-hotspots",
    "cross-boundary-coupling",
    "good-test-presence",
  ],
  "pr-flow": [
    "healthy-pr-throughput",
    "pr-backlog",
    "fast-pr-cycle",
    "slow-pr-cycle",
  ],
  deps: [
    "vulnerable-deps",
    "outdated-deps",
    "deprecated-deps",
    "fresh-deps",
  ],
  hygiene: ["missing-hygiene", "metadata-dominance"],
};

const DIMENSION_LABELS: Record<DimensionId, string> = {
  activity: "Activity",
  team: "Team",
  code: "Code",
  "pr-flow": "PR flow",
  deps: "Dependencies",
  hygiene: "Hygiene",
};

const STATUS_WORDS: Record<DimensionStatus, string> = {
  critical: "Critical",
  warning: "Needs work",
  healthy: "Healthy",
  solo: "Solo",
  unknown: "Unknown",
};

// ---------------- Picker ----------------

interface MatchedSignals {
  working: HealthSignal[];
  needsWork: HealthSignal[];
  questions: HealthSignal[];
}

/** Fold the dimension's relevant signals out of the full extractHealthSignals
 *  buckets. */
function matchSignals(
  ids: readonly string[],
  signals: { working: HealthSignal[]; needsWork: HealthSignal[]; questions: HealthSignal[] }
): MatchedSignals {
  const idSet = new Set(ids);
  return {
    working: signals.working.filter((s) => idSet.has(s.id)),
    needsWork: signals.needsWork.filter((s) => idSet.has(s.id)),
    questions: signals.questions.filter((s) => idSet.has(s.id)),
  };
}

/** Pick the "leading" signal whose copy we surface as the tile detail.
 *  Priority: high-severity needsWork → other needsWork → questions →
 *  working. Returns the first match in each tier so order in signals.ts
 *  is preserved. */
function pickLeadSignal(matched: MatchedSignals): HealthSignal | undefined {
  const high = matched.needsWork.find((s) => s.severity === "high");
  if (high) return high;
  const otherNeedsWork = matched.needsWork[0];
  if (otherNeedsWork) return otherNeedsWork;
  const question = matched.questions[0];
  if (question) return question;
  return matched.working[0];
}

/** Trim a signal detail to its first concrete clause — drops trailing
 *  prose like "— review is the bottleneck" so the tile shows the number
 *  + fact, not the editorial. Falls back to the title if the detail
 *  doesn't yield a useful clause. */
function shortDetail(signal: HealthSignal): string {
  const d = signal.detail;
  if (!d) return signal.title;

  // Split on em-dash first — the canonical "fact — verdict" pattern
  // used across signals.ts ("X folders maintained by a single contributor
  // — high bus factor risk").
  const dashIdx = d.indexOf(" — ");
  if (dashIdx > 10) return d.slice(0, dashIdx).trim();

  // Fall back to first sentence boundary.
  const sentIdx = d.indexOf(". ");
  if (sentIdx > 10) return d.slice(0, sentIdx + 1).trim();

  // Detail is already short — use as-is.
  return d.length <= 120 ? d : signal.title;
}

/** Status logic per dimension. Returns the dimension-specific
 *  (status, statusLabel) pair. */
function pickStatus(
  dimension: DimensionId,
  matched: MatchedSignals
): { status: DimensionStatus; statusLabel: string } {
  const hasHigh = matched.needsWork.some((s) => s.severity === "high");
  const hasNeedsWork = matched.needsWork.length > 0;
  const hasQuestion = matched.questions.length > 0;
  const hasWorking = matched.working.length > 0;

  // Team dimension: solo-project is informational, not a concern. When it's
  // the ONLY signal, the dimension is "Solo" (neutral), not warning.
  if (dimension === "team") {
    const onlySolo =
      matched.questions.length === 1 &&
      matched.questions[0].id === "solo-project" &&
      !hasNeedsWork &&
      !hasWorking;
    if (onlySolo) return { status: "solo", statusLabel: STATUS_WORDS.solo };
  }

  if (hasHigh) return { status: "critical", statusLabel: STATUS_WORDS.critical };
  if (hasNeedsWork) {
    return { status: "warning", statusLabel: STATUS_WORDS.warning };
  }
  // Questions are mildly concerning — they're observations needing human
  // judgment. Treat as warning except for the solo-project special case
  // already handled above.
  if (hasQuestion) {
    return { status: "warning", statusLabel: STATUS_WORDS.warning };
  }
  if (hasWorking) {
    return { status: "healthy", statusLabel: STATUS_WORDS.healthy };
  }

  // Hygiene dimension: when nothing fires, default to healthy. The signals
  // that fire here are all "things to fix" (no README, metadata-heavy
  // repo) — silence is genuinely good news. Other dimensions stay
  // "unknown" because silence might just mean we lack data (no PRs
  // tracked, no codeGraph, etc.).
  if (dimension === "hygiene") {
    return { status: "healthy", statusLabel: STATUS_WORDS.healthy };
  }

  return { status: "unknown", statusLabel: STATUS_WORDS.unknown };
}

/** Pure function: snapshot → 6 dimension summaries in fixed order. The
 *  fixed order matters for visual stability across snapshots — tiles
 *  shouldn't shuffle when severity changes. */
export function summarizeHealth(snap: AnalysisSnapshot): DimensionSummary[] {
  const signals = extractHealthSignals(snap);

  const order: DimensionId[] = [
    "activity",
    "team",
    "code",
    "pr-flow",
    "deps",
    "hygiene",
  ];

  return order.map((id) => {
    const matched = matchSignals(DIMENSION_SIGNAL_IDS[id], signals);
    const { status, statusLabel } = pickStatus(id, matched);
    const lead = pickLeadSignal(matched);
    return {
      id,
      label: DIMENSION_LABELS[id],
      status,
      statusLabel,
      detail: lead ? shortDetail(lead) : undefined,
      signalCount:
        matched.working.length +
        matched.needsWork.length +
        matched.questions.length,
    };
  });
}
