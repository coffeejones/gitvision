// SecurityPanel — top-level orchestrator for /session/[id]/security
// (v0.81+, Design A redesign).
//
// Replaces the original three-stacked-sections layout with a two-
// part composition: a compact status grid at the top (one tile per
// scanner) followed by a unified, severity-sorted findings list.
//
// Why the redesign: three sections of the same rhythm made the page
// repetitive — clean sessions had three near-identical "Clean"
// boxes stacked vertically; sessions with findings buried severity
// inside per-scanner groupings. The status grid lets visitors read
// "overall security posture" in 2 seconds; the unified list puts
// HIGH-severity findings on top regardless of which scanner emitted
// them. Matches the pattern Snyk + GitHub Dependabot use.

import type { AnalysisSnapshot } from "@/lib/types";
import { findIncidentMatches } from "@/lib/security/knownIncidents";
import { KNOWN_INCIDENTS } from "@/lib/security/knownIncidents";
import { TOK } from "@/lib/sessionTheme";
import { RollupBar } from "@/components/views/RollupBar";
import { AnchorGlow } from "@/components/views/AnchorGlow";
import { StatusGrid } from "./StatusGrid";
import { FindingsList } from "./FindingsList";

interface Props {
  snapshot: AnalysisSnapshot;
  sessionId: string;
}

export function SecurityPanel({ snapshot, sessionId }: Props) {
  const incidentMatches = findIncidentMatches(snapshot);
  const secretFindings = snapshot.secretFindings?.findings ?? [];
  const patternFindings = snapshot.riskyPatternFindings?.findings ?? [];
  const sinkReport = snapshot.sinkFindings;
  // Sinks nothing can reach and nothing calls are the one class this panel
  // does NOT lead with — they are the noise the reachability pass exists to
  // demote. They stay counted in the tile so the number is never quietly
  // smaller than what was scanned.
  const sinkFindings = (sinkReport?.findings ?? []).filter(
    (f) => f.reachability !== "unreachable",
  );

  // Per-scanner status state derivation. "Not scanned" only applies
  // to scanners that NEED a data field that's missing from the
  // snapshot (pre-v0.81 / scan-failed cases). Incidents always have
  // a "scanned" state — they only depend on the deps data which
  // every modern snapshot carries.
  const incidentsState = incidentMatches.length > 0 ? "findings" : "clean";
  const secretsState =
    snapshot.secretFindings === undefined
      ? "not-scanned"
      : secretFindings.length > 0
        ? "findings"
        : "clean";
  const patternsState =
    snapshot.riskyPatternFindings === undefined
      ? "not-scanned"
      : patternFindings.length > 0
        ? "findings"
        : "clean";

  // "Not scanned" here means code analysis never produced a graph (timeout or
  // failure), which is different from "scanned, found nothing".
  const sinksState =
    sinkReport === undefined
      ? "not-scanned"
      : sinkFindings.length > 0
        ? "findings"
        : "clean";

  const patternsFileCount = new Set(
    patternFindings.map((f) => f.filePath),
  ).size;

  // Phase 2 rollup — the "am I okay, and by how much?" severity split above the
  // fold. Reuses the same three arrays this panel already reads (zero new
  // compute). A tally, not a grade: incidents + critical/high secrets are the
  // heat; medium secrets are the caution tier; risky patterns are info-only.
  const rollupHigh =
    incidentMatches.length +
    secretFindings.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    ).length;
  const rollupMedium = secretFindings.filter(
    (f) => f.severity === "medium",
  ).length;
  // Only PROVEN reach counts as high in the rollup. An unresolved path is a
  // gap in our readers, not a claim about the code, and inflating the headline
  // with it would undo the filtering.
  const rollupInfo = patternFindings.length;
  const reachableHigh = sinkFindings.filter(
    (f) => f.reachability === "reachable" && f.severity === "high",
  ).length;
  const sinkMedium = sinkFindings.filter(
    (f) => f.reachability === "reachable" && f.severity === "medium",
  ).length;
  const notScanned = [
    sinksState === "not-scanned" ? "code paths" : null,
    secretsState === "not-scanned" ? "secrets" : null,
    patternsState === "not-scanned" ? "patterns" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <RollupBar
        segments={[
          { count: rollupHigh + reachableHigh, color: TOK.rose, label: "high" },
          { count: rollupMedium + sinkMedium, color: TOK.amber, label: "medium" },
          { count: rollupInfo, color: TOK.textMuted, label: "informational" },
        ]}
        emptyLabel="No findings across any scanner"
        trailing={
          notScanned.length > 0
            ? `${notScanned.join(" + ")} not scanned`
            : undefined
        }
      />
      <AnchorGlow>
      <StatusGrid
        incidents={{
          title: "Incidents",
          subtitle: `${KNOWN_INCIDENTS.length} curated supply-chain attacks`,
          state: incidentsState,
          countLabel:
            incidentMatches.length === 1
              ? "1 match"
              : `${incidentMatches.length} matches`,
        }}
        secrets={{
          title: "Secrets",
          subtitle: "Regex scan of source + config files",
          state: secretsState,
          countLabel:
            secretFindings.length === 1
              ? "1 finding"
              : `${secretFindings.length} findings`,
        }}
        sinks={
          sinkReport === undefined
            ? undefined
            : {
                title: "Code paths",
                // The subtitle states the method, because the number only means
                // something if you know what was walked.
                subtitle:
                  sinkReport.entryPoints > 0
                    ? `Dangerous calls traced from ${sinkReport.entryPoints} entry point${sinkReport.entryPoints === 1 ? "" : "s"}`
                    : "Dangerous calls — no entry points identified",
                state: sinksState,
                countLabel:
                  sinkReport.counts.reachable > 0
                    ? `${sinkReport.counts.reachable} reachable`
                    : `${sinkFindings.length} to review`,
              }
        }
        patterns={{
          title: "Patterns",
          subtitle: "eval / new Function / exec scanner",
          state: patternsState,
          countLabel:
            patternFindings.length === 1
              ? `1 in ${patternsFileCount} file`
              : `${patternFindings.length} in ${patternsFileCount} files`,
        }}
      />
      </AnchorGlow>

      <div data-rv>
        <FindingsList
          incidentMatches={incidentMatches}
          secretFindings={secretFindings}
          patternFindings={patternFindings}
          sinkFindings={sinkFindings}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
