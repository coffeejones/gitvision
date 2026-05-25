// PatternsSection — risky-eval-patterns findings (#20) for
// /session/[id]/security (v0.81+). Reads from
// snapshot.riskyPatternFindings populated by analyzeRepo's
// scanForRiskyPatterns pass.
//
// Each finding shows path:line + the actual source snippet that
// matched + which pattern (eval / new Function / exec). Snippets
// are truncated at 200 chars by the scanner — we render them in
// a mono block to mirror "this is what your code looks like".

import { Code2, ShieldCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import type { RiskyPatternFinding } from "@/lib/security/riskyPatterns";
import { SectionHeader } from "./SectionHeader";

interface Props {
  findings: RiskyPatternFinding[];
  truncated?: string;
  hasScanData: boolean;
}

export function PatternsSection({ findings, truncated, hasScanData }: Props) {
  if (!hasScanData) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Dynamic-execution patterns"
          subtitle="Scanner for eval(), new Function(), and Python exec() — primitives that execute strings as code at runtime."
          statusLabel="Not scanned"
          statusColor={TOK.textMuted}
        />
        <NoScanState />
      </section>
    );
  }

  const hasFindings = findings.length > 0;
  const fileCount = new Set(findings.map((f) => f.filePath)).size;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Dynamic-execution patterns"
        subtitle="Scanner for eval(), new Function(), and Python exec() — primitives that execute strings as code at runtime."
        statusLabel={
          hasFindings
            ? `${findings.length} in ${fileCount} file${fileCount === 1 ? "" : "s"}`
            : "Clean"
        }
        statusColor={hasFindings ? TOK.amber : TOK.accent}
      />

      {hasFindings ? (
        <div className="flex flex-col gap-2">
          <p
            className="text-xs italic"
            style={{ color: TOK.textMuted }}
          >
            These execute strings as code at runtime — verify the input is
            trusted. Legitimate uses exist (templating, REPLs, codegen);
            review each occurrence in context.
          </p>
          {findings.map((f, i) => (
            <article
              key={`${f.filePath}-${f.line}-${i}`}
              className="flex flex-col gap-2 p-4 rounded-lg"
              style={{
                background: TOK.surface,
                border: `1px solid ${TOK.border}`,
              }}
            >
              <header className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Code2
                    size={12}
                    style={{ color: TOK.amber, flexShrink: 0 }}
                  />
                  <span
                    className="text-xs font-mono truncate"
                    style={{ color: TOK.textPrimary }}
                    title={`${f.filePath}:${f.line}`}
                  >
                    {f.filePath}:{f.line}
                  </span>
                </div>
                <span
                  className="text-[10px] uppercase tracking-[0.14em] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    background: `${TOK.amber}1a`,
                    color: TOK.amber,
                    border: `1px solid ${TOK.amber}40`,
                  }}
                >
                  {f.patternName}
                </span>
              </header>
              <pre
                className="text-xs px-3 py-2 rounded font-mono overflow-x-auto"
                style={{
                  background: TOK.bgDeep,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textSecondary,
                  margin: 0,
                }}
              >
                {f.snippet}
              </pre>
            </article>
          ))}
          {truncated && (
            <p
              className="text-xs italic px-1"
              style={{ color: TOK.textMuted }}
            >
              {truncated}
            </p>
          )}
        </div>
      ) : (
        <CleanState
          summary="No dynamic-execution patterns detected in source."
          detail="Scanner walks JS / TS / Python files (skipping tests, builds, node_modules, minified bundles) for eval(), new Function(), and exec() — primitives that execute runtime strings as code."
        />
      )}
    </section>
  );
}

function CleanState({
  summary,
  detail,
}: {
  summary: string;
  detail: string;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-lg"
      style={{
        background: "rgba(255, 255, 255, 0.02)",
        border: `1px solid ${TOK.border}`,
      }}
    >
      <ShieldCheck
        size={14}
        style={{ color: TOK.accent, flexShrink: 0, marginTop: 2 }}
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm" style={{ color: TOK.textPrimary }}>
          {summary}
        </p>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          {detail}
        </p>
      </div>
    </div>
  );
}

function NoScanState() {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3 rounded-lg"
      style={{
        background: "rgba(255, 255, 255, 0.02)",
        border: `1px dashed ${TOK.border}`,
      }}
    >
      <p className="text-sm" style={{ color: TOK.textSecondary }}>
        Scan data not available on this snapshot.
      </p>
      <p className="text-xs" style={{ color: TOK.textMuted }}>
        Refresh the session to populate dynamic-execution-pattern findings.
      </p>
    </div>
  );
}
