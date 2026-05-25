// SecurityPanel — top-level orchestrator for /session/[id]/security
// (v0.81+). Composes three focused sub-sections, one per scanner:
//
//   IncidentsSection  — known-incident-match (#19): curated supply-
//                       chain DB. HIGH severity always when matched.
//   SecretsSection    — secretFindings: regex-based scan of source
//                       + config files for committed credentials.
//   PatternsSection   — risky-eval-patterns (#20): dynamic-execution
//                       primitives (eval / new Function / exec).
//                       Informational — questions bucket equivalent.
//
// Ordering: highest stakes first (incidents → secrets → patterns).
// A "clean" section is still rendered so visitors see the full
// scope of what we scan even when there's nothing to flag — that's
// the brand promise of "deterministic, here's the audit trail".

import { Shield } from "lucide-react";
import { TOK } from "@/lib/theme";
import type { AnalysisSnapshot } from "@/lib/types";
import { findIncidentMatches } from "@/lib/security/knownIncidents";
import { IncidentsSection } from "./IncidentsSection";
import { SecretsSection } from "./SecretsSection";
import { PatternsSection } from "./PatternsSection";

interface Props {
  snapshot: AnalysisSnapshot;
}

export function SecurityPanel({ snapshot }: Props) {
  const incidentMatches = findIncidentMatches(snapshot);
  const secretFindings = snapshot.secretFindings?.findings ?? [];
  const patternFindings = snapshot.riskyPatternFindings?.findings ?? [];

  const hasAnyFindings =
    incidentMatches.length > 0 ||
    secretFindings.length > 0 ||
    patternFindings.length > 0;

  return (
    <div className="flex flex-col gap-10">
      {/* Top summary strip — single-line verdict so visitors can
       *  scan the page status in one glance before diving into
       *  individual sections. */}
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-lg"
        style={{
          background: hasAnyFindings ? `${TOK.rose}0a` : `${TOK.accent}0a`,
          border: `1px solid ${
            hasAnyFindings ? `${TOK.rose}33` : `${TOK.accent}33`
          }`,
        }}
      >
        <Shield
          size={16}
          style={{
            color: hasAnyFindings ? TOK.rose : TOK.accent,
            flexShrink: 0,
            marginTop: 2,
          }}
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <p
            className="text-sm font-semibold"
            style={{
              color: hasAnyFindings ? TOK.rose : TOK.accent,
              letterSpacing: "-0.01em",
            }}
          >
            {hasAnyFindings
              ? "Findings worth reviewing across one or more scanners"
              : "Clean across all three scanners"}
          </p>
          <p className="text-xs" style={{ color: TOK.textMuted }}>
            Supply-chain incidents · secret leakage · dynamic-execution
            patterns. All results are deterministic — no AI involved.
          </p>
        </div>
      </div>

      <IncidentsSection matches={incidentMatches} />
      <SecretsSection
        findings={secretFindings}
        truncated={snapshot.secretFindings?.truncated}
        hasScanData={!!snapshot.secretFindings}
      />
      <PatternsSection
        findings={patternFindings}
        truncated={snapshot.riskyPatternFindings?.truncated}
        hasScanData={!!snapshot.riskyPatternFindings}
      />
    </div>
  );
}
