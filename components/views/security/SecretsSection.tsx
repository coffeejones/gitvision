// SecretsSection — committed-credentials scanner findings for
// /session/[id]/security (v0.81+). Reads from snapshot.secretFindings
// which the analyze pipeline populates via lib/security/secretsScan.
//
// Each finding shows path:line + redacted preview + severity badge.
// The scanner already redacts (first-6 + last-4 of the match), so
// rendering the preview as-is is safe.

import { KeyRound, ShieldCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import type { SecretFinding } from "@/lib/security/types";
import { SectionHeader } from "./SectionHeader";

interface Props {
  findings: SecretFinding[];
  truncated?: string;
  /** True when the snapshot has secretFindings populated. False on
   *  pre-v0.61 snapshots that pre-date the scanner — those should
   *  show "scan not available" rather than "clean". */
  hasScanData: boolean;
}

export function SecretsSection({ findings, truncated, hasScanData }: Props) {
  if (!hasScanData) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Secret leakage"
          subtitle="Regex-based scan for committed credentials (API keys, tokens, private keys)."
          statusLabel="Not scanned"
          statusColor={TOK.textMuted}
        />
        <NoScanState />
      </section>
    );
  }

  const hasFindings = findings.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Secret leakage"
        subtitle="Regex-based scan for committed credentials (API keys, tokens, private keys)."
        statusLabel={
          hasFindings
            ? `${findings.length} finding${findings.length === 1 ? "" : "s"}`
            : "Clean"
        }
        statusColor={hasFindings ? TOK.rose : TOK.accent}
      />

      {hasFindings ? (
        <div className="flex flex-col gap-2">
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
                  <KeyRound
                    size={12}
                    style={{ color: TOK.rose, flexShrink: 0 }}
                  />
                  <span
                    className="text-xs font-mono truncate"
                    style={{ color: TOK.textPrimary }}
                    title={`${f.filePath}:${f.line}`}
                  >
                    {f.filePath}:{f.line}
                  </span>
                </div>
                <SeverityBadge severity={f.severity} />
              </header>
              <div className="flex flex-col gap-1">
                <span
                  className="text-[10px] uppercase tracking-[0.14em] font-medium"
                  style={{ color: TOK.textMuted }}
                >
                  {f.patternLabel}
                </span>
                <code
                  className="text-xs px-2 py-1 rounded font-mono"
                  style={{
                    background: TOK.surfaceElevated,
                    border: `1px solid ${TOK.border}`,
                    color: TOK.textSecondary,
                    width: "fit-content",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {f.preview}
                </code>
              </div>
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
          summary="No high-confidence secrets detected in source."
          detail="Scanner walks source + config files (.env, package.json, YAML, etc.) for API-key, token, and private-key patterns. Matches are filtered for confidence before surfacing — false-positive-bounded by design."
        />
      )}
    </section>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: SecretFinding["severity"];
}) {
  const palette =
    severity === "high"
      ? { bg: `${TOK.rose}1a`, text: TOK.rose, border: `${TOK.rose}40` }
      : severity === "medium"
        ? {
            bg: `${TOK.amber}1a`,
            text: TOK.amber,
            border: `${TOK.amber}40`,
          }
        : {
            bg: "rgba(255,255,255,0.04)",
            text: TOK.textMuted,
            border: TOK.border,
          };
  return (
    <span
      className="text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
      style={{
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
      }}
    >
      {severity}
    </span>
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
        Refresh the session to populate secret-scan findings.
      </p>
    </div>
  );
}
