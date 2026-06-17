// The Read — Adoption (Mode A).
//
// Reframes the deterministic 4-lens Verdict into the one decision a developer
// actually agonizes over: "should my project depend on THIS repo?" — an
// ADOPT / GUARDED / AVOID call.
//
// This invents NO new analysis. It reweights the already-computed Verdict and
// quotes the already-computed signals:
//   - computeVerdict(snap)        -> the base outcome + grade + score (caller passes it in)
//   - extractHealthSignals(snap)  -> the working / needsWork signals we quote verbatim
//   - snap.secretFindings         -> escalating secrets (a hard dealbreaker)
//
// Two deliberate honesty rules, both from how the signal engine behaves:
//   1. We only DOWNGRADE, never upgrade, off the base outcome. Adoption weights
//      maintenance + supply harder than the overall grade (a clean codebase
//      maintained by one person is still a risky thing to depend on), so an
//      otherwise-"cleared" repo can read GUARDED — but we never claim a repo is
//      safer to depend on than its own verdict says.
//   2. "Reasons it's safe" come ONLY from `working` signals, which fire on
//      genuine evidence. We never derive safety from a lens that merely voted
//      "pass" — in this engine silence means "not assessed" (common on non-JS
//      repos where a detector didn't run), not "good", so we don't claim it.

import type { AnalysisSnapshot, HealthSignal, HealthSignals } from "../types";
import type { Verdict, VerdictOutcome } from "./verdict";
import { extractHealthSignals } from "../signals";

export type AdoptionReadLevel = "ADOPT" | "GUARDED" | "AVOID";

export interface AdoptionReason {
  /** Stable signal id (or a synthetic key) — for React keys + debugging. */
  id: string;
  /** Short category label shown in mono, e.g. "supply", "bus factor". */
  tag: string;
  /** The human-readable line — a literal quote of the computed signal. */
  text: string;
  /** Only on hesitations: the severity that drove it. */
  severity?: "low" | "medium" | "high";
}

export interface AdoptionRead {
  read: AdoptionReadLevel;
  /** One-line synthesis under the verdict word. */
  headline: string;
  /** Up to 3 reasons to trust it (from `working` signals only). */
  safe: AdoptionReason[];
  /** Up to 3 reasons to hesitate (from `needsWork`, severity-sorted). */
  hesitate: AdoptionReason[];
  /** "If you adopt —" concrete guardrails, derived from the hesitations. */
  guardrails: string[];
  /** Lets the card reconcile the read against the headline grade. */
  reconcile: {
    grade: string;
    score: number;
    /** Present only when the read diverges from the base outcome mapping. */
    why?: string;
  };
  /** The single most severe hesitation — the UI paints this one orange. */
  criticalReasonId?: string;
  /** Set when only a subtree was analyzed, so the card can caveat. */
  scopeNote?: string;
}

const LEVEL_RANK: Record<AdoptionReadLevel, number> = {
  ADOPT: 0,
  GUARDED: 1,
  AVOID: 2,
};
const RANK_LEVEL: AdoptionReadLevel[] = ["ADOPT", "GUARDED", "AVOID"];

/** cleared -> ADOPT, conditional -> GUARDED, returned -> AVOID. */
const BASE_BY_OUTCOME: Record<VerdictOutcome, AdoptionReadLevel> = {
  cleared: "ADOPT",
  conditional: "GUARDED",
  returned: "AVOID",
};

/** Worse of two reads (we only ever move toward more caution). */
function worst(a: AdoptionReadLevel, b: AdoptionReadLevel): AdoptionReadLevel {
  return RANK_LEVEL[Math.max(LEVEL_RANK[a], LEVEL_RANK[b])];
}

/** Map a signal id to a short mono tag. Unknown ids fall back to a cleaned id
 *  so the card never shows a raw kebab-case string but also never crashes. */
const TAG_BY_ID: Record<string, string> = {
  "bus-factor-risk": "bus factor",
  "solo-project": "bus factor",
  stale: "cadence",
  "very-active": "activity",
  "commit-cadence": "activity",
  "real-code-activity": "activity",
  "broad-ownership": "ownership",
  "contributor-spread": "ownership",
  "good-test-presence": "tests",
  "untested-hotspots": "tests",
  "vulnerable-deps": "supply",
  "deprecated-deps": "supply",
  "outdated-deps": "supply",
  "fresh-deps": "supply",
  "known-incident": "supply",
  "cross-boundary-coupling": "architecture",
  "deep-dependency-chains": "architecture",
  "pr-throughput": "throughput",
  "pr-backlog": "throughput",
  "pr-cycle-time": "review",
};

function tagFor(id: string): string {
  return TAG_BY_ID[id] ?? id.replace(/-/g, " ");
}

function toReason(sig: HealthSignal): AdoptionReason {
  // The detail carries the specifics (counts, dates) that make the quote
  // defensible; fall back to the title when a signal has no detail.
  return {
    id: sig.id,
    tag: tagFor(sig.id),
    text: sig.detail || sig.title,
    severity: sig.severity,
  };
}

/** Order `working` signals by how much they matter to an adoption decision, so
 *  the three we surface are the ones a chooser actually cares about. */
const SAFE_PRIORITY = [
  "fresh-deps",
  "broad-ownership",
  "very-active",
  "good-test-presence",
  "contributor-spread",
  "commit-cadence",
  "real-code-activity",
];
function safePriority(id: string): number {
  const i = SAFE_PRIORITY.indexOf(id);
  return i === -1 ? SAFE_PRIORITY.length : i;
}

const HEADLINE: Record<AdoptionReadLevel, string> = {
  ADOPT: "Safe to depend on — the signals are clean across the board.",
  GUARDED: "Usable, with conditions. Mind the guardrails below.",
  AVOID: "Hold off — there are dealbreakers you'd be inheriting.",
};

/** Build the "if you adopt —" guardrails from whichever risks actually fired.
 *  Each maps a concrete, do-this-next action onto a detected condition. */
function buildGuardrails(flags: {
  busFactor: boolean;
  stale: boolean;
  deprecated: boolean;
  vulnerable: boolean;
  secrets: boolean;
}): string[] {
  const g: string[] = [];
  if (flags.secrets)
    g.push("Treat the exposed secrets as compromised — assume they need rotating.");
  if (flags.vulnerable) g.push("Audit the flagged CVEs before you ship against it.");
  if (flags.busFactor)
    g.push("Single maintainer — have a fork-or-migrate plan before you rely on it.");
  if (flags.stale) g.push("Pin the exact version — releases have stalled.");
  if (flags.deprecated)
    g.push("Plan a migration path off the deprecated packages.");
  if (g.length === 0) g.push("Pin a known-good version and you're set.");
  return g.slice(0, 4);
}

/**
 * Compute the adoption read for a snapshot. `verdict` is passed in by the
 * caller (the verdict page already computed it) so we don't recompute it.
 * `signals` defaults to a fresh extraction but can be injected — the page can
 * pass a value it already has, and tests can exercise the reweighting logic
 * directly without going through the detector thresholds.
 */
export function computeAdoptionRead(
  snap: AnalysisSnapshot,
  verdict: Verdict,
  signals: HealthSignals = extractHealthSignals(snap)
): AdoptionRead {
  const needsWork = signals.needsWork; // already severity-sorted, high -> low
  const working = signals.working;

  const byId = (list: HealthSignal[], id: string) =>
    list.find((s) => s.id === id);

  // Adoption-critical conditions, read off the computed signals.
  const busFactorSig =
    byId(needsWork, "bus-factor-risk") ?? byId(signals.questions, "solo-project");
  const staleSig = byId(needsWork, "stale");
  const vulnSig = byId(needsWork, "vulnerable-deps"); // detector pre-filters to runtime + high
  const deprecatedSig = byId(needsWork, "deprecated-deps");
  const escalatingSecrets = (snap.secretFindings?.findings ?? []).filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );

  const flags = {
    busFactor: !!busFactorSig,
    stale: !!staleSig,
    deprecated: !!deprecatedSig,
    vulnerable: !!vulnSig,
    secrets: escalatingSecrets.length > 0,
  };

  // Base from the verdict outcome, then downgrade (never upgrade).
  const base = BASE_BY_OUTCOME[verdict.outcome];
  let cap: AdoptionReadLevel = "ADOPT";
  if (flags.vulnerable || flags.secrets) cap = "AVOID";
  else if (flags.busFactor || flags.stale || flags.deprecated) cap = "GUARDED";
  const read = worst(base, cap);

  // Reasons to trust — working signals only, most adoption-relevant first.
  const safe: AdoptionReason[] = [...working]
    .sort((a, b) => safePriority(a.id) - safePriority(b.id))
    .slice(0, 3)
    .map(toReason);

  // Reasons to hesitate. Start from needsWork, add the solo-project question if
  // it drove the read, and a synthetic line for exposed secrets. Then order so
  // the dealbreakers that force an AVOID (runtime CVEs, secrets) lead — that's
  // the single row the card paints orange — with the rest by severity.
  const hesitate: HealthSignal[] = [...needsWork];
  if (
    busFactorSig &&
    busFactorSig.id === "solo-project" &&
    !needsWork.some((s) => s.id === "bus-factor-risk")
  ) {
    hesitate.push({ ...busFactorSig, severity: "medium" });
  }
  if (flags.secrets) {
    hesitate.push({
      id: "exposed-secrets",
      title: `${escalatingSecrets.length} exposed secret${escalatingSecrets.length === 1 ? "" : "s"}`,
      detail: "credentials found in the source — a hard dealbreaker for a dependency.",
      evidence: {},
      severity: "high",
    } as HealthSignal);
  }
  const SEV_RANK = { high: 3, medium: 2, low: 1 } as const;
  const isDealbreaker = (id: string) =>
    id === "exposed-secrets" || id === "vulnerable-deps";
  hesitate.sort((a, b) => {
    const d = Number(isDealbreaker(b.id)) - Number(isDealbreaker(a.id));
    if (d !== 0) return d;
    return (
      (b.severity ? SEV_RANK[b.severity] : 0) -
      (a.severity ? SEV_RANK[a.severity] : 0)
    );
  });
  const hesitateReasons = hesitate.slice(0, 3).map(toReason);

  const guardrails = buildGuardrails(flags);

  // Reconcile: explain divergence only when caution pushed the read worse than
  // the base outcome would have given on its own.
  let why: string | undefined;
  if (LEVEL_RANK[read] > LEVEL_RANK[base]) {
    const drivers: string[] = [];
    if (flags.secrets) drivers.push("exposed secrets");
    if (flags.vulnerable) drivers.push("known CVEs");
    if (flags.busFactor) drivers.push("bus factor");
    if (flags.stale) drivers.push("release cadence");
    if (flags.deprecated) drivers.push("deprecated deps");
    why = `Overall grade ${verdict.grade}, but adoption reads ${read} — it weights ${drivers.join(
      " + "
    )} more heavily than the grade does.`;
  }

  return {
    read,
    headline: HEADLINE[read],
    safe,
    hesitate: hesitateReasons,
    guardrails,
    reconcile: { grade: verdict.grade, score: verdict.score, why },
    criticalReasonId: hesitateReasons[0]?.id,
    scopeNote: snap.analyzedSubdir
      ? `Based on the ${snap.analyzedSubdir} subtree only.`
      : undefined,
  };
}
