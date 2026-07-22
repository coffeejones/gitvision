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
import type { RiskyPatternFinding } from "./riskyPatterns";
import type { SecretFinding } from "./types";

export type UnifiedFinding =
  | { kind: "incident"; severity: "high"; data: IncidentMatch }
  | { kind: "secret"; severity: "high" | "medium" | "low"; data: SecretFinding }
  | { kind: "pattern"; severity: "info"; data: RiskyPatternFinding };

export const SEVERITY_RANK: Record<UnifiedFinding["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Merge the three scanners into one list, sorted most-severe first. Stable:
 *  Array.prototype.sort is stable in modern engines, so equal-rank items keep
 *  input order (incidents → secrets → patterns). */
export function buildUnifiedFindings(
  incidentMatches: IncidentMatch[],
  secretFindings: SecretFinding[],
  patternFindings: RiskyPatternFinding[],
): UnifiedFinding[] {
  const all: UnifiedFinding[] = [
    ...incidentMatches.map(
      (m) => ({ kind: "incident", severity: "high", data: m }) as const,
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
  all.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return all;
}
