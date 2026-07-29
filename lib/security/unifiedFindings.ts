// Unifies the three security scanners (known incidents, secret scan, risky
// patterns) into one severity-ranked list. Pure + testable — extracted from the
// FindingsList component so the mapping + sort, the part that decides what a
// reader sees first, has a regression guard.
//
// The unified scale is high | medium | low | info — deliberately NO "critical"
// tier. A leaked-credential secret is "critical" in its own model (the dedicated
// Secrets panel shows that), but this mixed list caps at "high": a critical
// secret maps to high, so it takes the top badge and sorts first. Leaving it
// "critical" fell through the severity palette to the muted "info" styling AND
// hit an undefined rank → NaN sort — the most severe finding rendered and ranked
// as the least.

import type { IncidentMatch } from "./knownIncidents";
import type { ClassifiedSink } from "./reachability";
import type { RiskyPatternFinding } from "./riskyPatterns";
import type { SecretFinding } from "./types";

export type UnifiedFinding =
  | { kind: "incident"; severity: "high"; data: IncidentMatch }
  | { kind: "secret"; severity: "high" | "medium" | "low"; data: SecretFinding }
  | { kind: "sink"; severity: "high" | "medium" | "low"; data: ClassifiedSink }
  | { kind: "pattern"; severity: "info"; data: RiskyPatternFinding };

/** How much the tool can actually SHOW about a finding, independent of how bad
 *  the operation would be. Only sinks carry reachability, so only they can
 *  reach a tier above zero — an incident or a leaked secret is already a fact,
 *  and sorts on severity as before. */
function evidenceTier(f: UnifiedFinding): number {
  if (f.kind !== "sink" || f.data.reachability !== "reachable") return 0;
  return f.data.taint ? 2 : 1;
}

export const SEVERITY_RANK: Record<UnifiedFinding["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Merge the scanners into one list, sorted most-severe first. Stable:
 *  Array.prototype.sort is stable in modern engines, so equal-rank items keep
 *  input order (incidents → secrets → sinks → patterns).
 *
 *  Sinks arrive already ordered by reachability-then-severity (classifySinks),
 *  and that order is preserved WITHIN a severity band by the stable sort. A
 *  reachable finding and an unknown one of the same class share a severity —
 *  the difference between them is confidence, which the row renders as its own
 *  axis rather than by inflating the severity. Only sinks we can say something
 *  about are passed in: see reachableFirst below. */
export function buildUnifiedFindings(
  incidentMatches: IncidentMatch[],
  secretFindings: SecretFinding[],
  patternFindings: RiskyPatternFinding[],
  sinkFindings: ClassifiedSink[] = [],
): UnifiedFinding[] {
  const all: UnifiedFinding[] = [
    ...incidentMatches.map(
      (m) => ({ kind: "incident", severity: "high", data: m }) as const,
    ),
    ...sinkFindings.map(
      (s) => ({ kind: "sink", severity: s.severity, data: s }) as const,
    ),
    ...secretFindings.map(
      (s) =>
        ({
          kind: "secret",
          // Cap at "high" — no critical tier in the unified list (see header).
          severity: s.severity === "critical" ? "high" : s.severity,
          data: s,
        }) as const,
    ),
    ...patternFindings.map(
      (p) => ({ kind: "pattern", severity: "info", data: p }) as const,
    ),
  ];
  // Severity alone is the wrong primary key once reachability exists.
  //
  // Found by running NetBox through the real pipeline: a mark_safe fed
  // `request.POST` across two functions AND traced from a route ranked BELOW
  // two exec() calls with no path to them at all, because exec is "high" and
  // mark_safe is "medium". That is the reachability work being computed and
  // then thrown away at the last step.
  //
  // So demonstrated findings sort first. A sink we can show is reachable AND
  // fed untrusted input is the strongest claim this tool makes; an unproven
  // high is a dangerous call nobody has been shown able to trigger. Severity
  // still orders everything within a tier, and the sort stays stable, so
  // classifySinks' own ordering survives inside each band.
  all.sort(
    (a, b) =>
      evidenceTier(b) - evidenceTier(a) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );
  return all;
}
