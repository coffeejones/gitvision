// Traffic-light health summary for the session Overview (v0.59 / A3).
//
// Maps the deterministic signals from extractHealthSignals() into 6
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
import { extractHealthSignals, getDependencyHealths } from "../signals";
import { unsupportedLanguageNote } from "../codeAnalysis/languageSupport";

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
    "concentrated-ownership",
  ],
  code: [
    "untested-hotspots",
    "cross-boundary-coupling",
    "good-test-presence",
    // v0.81+ signal #18 — pairs naturally with cross-boundary-coupling
    // as another graph-structure code-health concern.
    "deep-dependency-chains",
    // v0.81+ signal #20 — dynamic-execution patterns (eval / new
    // Function / exec). Always bucketed into questions, so it never
    // drives the Code tile to NEEDS WORK alone — but it does show
    // in the tile's contributing-signal count and on /signals.
    "risky-eval-patterns",
    // 2026-07: the first signals that actually read snap.codeGraph. Until these
    // landed, the whole function-level AST layer — complexity, call edges,
    // structural hashes — powered panels but never reached a dimension tile.
    "duplicate-implementations",
    "complexity-concentration",
    "unit-tested-core",
    "limited-direct-coverage",
    // Arc 1 shipped these detectors and then never mapped them, so assertion
    // quality moved no tile. It does now.
    "weak-suite",
    "assertion-dense-tests",
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
    // v0.81+ signal #19 — curated supply-chain incident matches.
    // Always high-severity when present; drives the Dependencies
    // tile to CRITICAL on any match.
    "known-incident-match",
  ],
  hygiene: [
    "missing-hygiene",
    "metadata-dominance",
    "ci-supply-chain-exposed",
    "ci-permissions-broad",
    "ci-hardened",
  ],
};

/** How many distinct deterministic signals feed the six tiles.
 *
 *  DERIVED, never typed. The product told users "20 deterministic signals" in
 *  five places and "21" in a sixth, while the real answer was 34 — a number
 *  nobody had recounted since the map grew. On a product whose whole claim is
 *  that the tiles are computed rather than guessed, a count that is wrong by
 *  fourteen is the worst possible place to be sloppy.
 *
 *  Note this is NOT the same number as VERDICT_SIGNAL_COUNT: the verdict's four
 *  lenses read a 30-id subset of these 34 (they skip the three CI-hardening
 *  signals and concentrated-ownership). One number for both surfaces would be
 *  wrong on one of them, which is probably how the drift started. */
export const HEALTH_SIGNAL_IDS: ReadonlySet<string> = new Set(
  Object.values(DIMENSION_SIGNAL_IDS).flat(),
);
export const HEALTH_SIGNAL_COUNT = HEALTH_SIGNAL_IDS.size;

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

// ---------------- Cross-snapshot diff (v0.62 / B5) ----------------

/** Direction of a per-dimension status change between two snapshots.
 *  unchanged = same status, OR a status switch that doesn't cross
 *  the "ok" boundary (e.g. healthy ↔ solo are both fine). */
export type DimensionChange = "improved" | "regressed" | "unchanged";

export interface DimensionDelta {
  id: DimensionId;
  fromStatus: DimensionStatus;
  toStatus: DimensionStatus;
  change: DimensionChange;
}

/** Severity rank for change-classification. healthy and solo share
 *  rank 0 because both are "ok" — a transition between them isn't a
 *  real improvement or regression, just a labeling change. unknown
 *  sits at 1 (data gap, not a problem). warning + critical climb.
 *
 *  improved: rank goes DOWN (toward healthy)
 *  regressed: rank goes UP (toward critical)
 *  unchanged: same rank (or healthy ↔ solo) */
const STATUS_RANK: Record<DimensionStatus, number> = {
  healthy: 0,
  solo: 0,
  unknown: 1,
  warning: 2,
  critical: 3,
};

function classifyChange(
  from: DimensionStatus,
  to: DimensionStatus
): DimensionChange {
  const fromRank = STATUS_RANK[from];
  const toRank = STATUS_RANK[to];
  if (toRank < fromRank) return "improved";
  if (toRank > fromRank) return "regressed";
  return "unchanged";
}

/** Compare two snapshots dimension-by-dimension. Returns one delta
 *  per dimension in the canonical order, so the caller can match
 *  outputs to summarizeHealth() positionally. Useful for surfacing
 *  "X changed since last visit" without having to call both
 *  summarizeHealth functions individually. */
export function diffHealthSummaries(
  prev: AnalysisSnapshot,
  curr: AnalysisSnapshot
): DimensionDelta[] {
  const prevSummaries = summarizeHealth(prev);
  const currSummaries = summarizeHealth(curr);
  return prevSummaries.map((p) => {
    const c = currSummaries.find((cs) => cs.id === p.id);
    if (!c) {
      // Shouldn't happen — both calls produce the same fixed-order
      // dimension list. Defensive fallback so a future signal-list
      // change can't crash the diff.
      return {
        id: p.id,
        fromStatus: p.status,
        toStatus: p.status,
        change: "unchanged",
      };
    }
    return {
      id: p.id,
      fromStatus: p.status,
      toStatus: c.status,
      change: classifyChange(p.status, c.status),
    };
  });
}

// ---------------- Multi-snapshot trend (v0.68 / C3) ----------------

/** Default number of snapshots to include in a trend series. Chosen
 *  to fit a small inline sparkline (~5 dots) without overwhelming the
 *  tile. Older snapshots get dropped from the head; if a session has
 *  fewer than this, we just return what's there. */
export const DEFAULT_TREND_WINDOW = 5;

/** Per-dimension trend data: the chronological-order series of
 *  statuses for a single dimension across recent snapshots. The
 *  array is oldest-first so renderers can map index → x-position
 *  directly. Length is bounded by the window size (default 5). */
export type DimensionTrend = Map<DimensionId, DimensionStatus[]>;

/** Compute a per-dimension trend across a sequence of snapshots.
 *  Returns a Map keyed by DimensionId, value = array of statuses in
 *  chronological order (oldest first). Designed for inline sparkline
 *  rendering on the Overview's HealthSummary tiles when a session
 *  has 3+ snapshots — fewer than that, the trend isn't really a
 *  trend, it's just a current-vs-previous comparison (we already
 *  have diffHealthSummaries for that case).
 *
 *  Window: takes the last N snapshots (default 5). Older history
 *  is summarized by the structural-diff panel; a sparkline is for
 *  the recent direction-of-travel. */
export function computeHealthTrend(
  snapshots: AnalysisSnapshot[],
  window: number = DEFAULT_TREND_WINDOW
): DimensionTrend {
  const slice = snapshots.slice(-window);
  const summariesPerSnapshot = slice.map((s) => summarizeHealth(s));

  const trend: DimensionTrend = new Map();
  // Use the first summary's dimension list as canonical ordering —
  // summarizeHealth always returns the same six dimensions in the
  // same order, so any snapshot's projection works.
  if (summariesPerSnapshot.length === 0) return trend;
  for (const dim of summariesPerSnapshot[0]) {
    const series: DimensionStatus[] = summariesPerSnapshot.map(
      (snapshotSummaries) => {
        const match = snapshotSummaries.find((d) => d.id === dim.id);
        // summarizeHealth always returns all 6 dimensions, but be
        // defensive — a future schema change can't quietly break
        // sparkline rendering.
        return match?.status ?? "unknown";
      }
    );
    trend.set(dim.id, series);
  }
  return trend;
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
      detail: lead ? shortDetail(lead) : capabilityGapDetail(id, status, snap),
      signalCount:
        matched.working.length +
        matched.needsWork.length +
        matched.questions.length,
    };
  });
}

/** Honest detail for "unknown" tiles when the gap is a CAPABILITY, not a
 *  stale snapshot. Without this, the UI falls back to "Refresh to populate"
 *  — a lie when the repo's language isn't parsed or no supported package
 *  manifest exists (a refresh can never populate those). Returns undefined
 *  when the generic fallback is the right message (e.g. genuinely old
 *  snapshots from before code analysis shipped). */
function capabilityGapDetail(
  id: DimensionId,
  status: DimensionStatus,
  snap: AnalysisSnapshot
): string | undefined {
  if (status !== "unknown") return undefined;
  if (id === "code") {
    // Graph present but empty = we swept and parsed nothing.
    const cg = snap.codeGraph;
    if (cg && cg.functions.length === 0) {
      const unsupported = unsupportedLanguageNote(snap.languages);
      return unsupported
        ? `${unsupported} isn't parsed yet`
        : "No parseable code found";
    }
  }
  if (id === "deps") {
    // Snapshot complete but no dependency healths = no manifest we read.
    const healths = getDependencyHealths(snap);
    if (snap.codeGraph && healths.length === 0) {
      return "No supported package manifests (npm, Cargo, PyPI)";
    }
  }
  return undefined;
}
