// "Possible secrets" panel for the session Overview (v0.61 / B1).
//
// Surfaces results of the regex-based secret scan run during analyze.
// Each finding shows pattern label + redacted preview + filepath:line,
// color-coded by severity. Hides itself when there are no findings —
// the headline override on pickHeadline already loudly announces the
// critical case at the top of the page, so this panel is the
// drill-down list, not the alarm.
//
// Privacy: previews are first-6 + "..." + last-4. Never the full
// credential. The detail tooltip on each finding explains how to
// rotate the leaked key — turning "uh oh" into actionable next-step.

import { ShieldAlert, AlertTriangle, Info } from "lucide-react";
import type {
  SecretFinding,
  SecretScanResult,
  SecretSeverity,
} from "@/lib/security/types";
import { STYLE, TOK } from "@/lib/sessionTheme";

interface SeverityStyle {
  fg: string;
  bg: string;
  ring: string;
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
}

const SEVERITY_STYLES: Record<SecretSeverity, SeverityStyle> = {
  critical: {
    fg: TOK.rose,
    bg: TOK.roseSoft,
    ring: `${TOK.rose}44`,
    Icon: ShieldAlert,
    label: "Critical",
  },
  high: {
    fg: TOK.amber,
    bg: TOK.amberSoft,
    ring: `${TOK.amber}44`,
    Icon: AlertTriangle,
    label: "High",
  },
  medium: {
    fg: TOK.textSecondary,
    bg: TOK.surfaceElevated,
    ring: TOK.border,
    Icon: Info,
    label: "Medium",
  },
};

/** Tally findings by severity for the eyebrow summary line. */
function summarize(findings: SecretFinding[]): string {
  const counts: Record<SecretSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
  };
  for (const f of findings) counts[f.severity]++;
  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  return parts.join(" · ");
}

interface Props {
  result: SecretScanResult;
}

export function SecretFindingsPanel({ result }: Props) {
  if (result.findings.length === 0) return null;

  return (
    <section
      id="secrets"
      className="flex flex-col gap-3"
      style={{ scrollMarginTop: "5rem" }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
            Possible secrets
          </span>
          <span className="text-xs" style={{ color: TOK.textMuted }}>
            · {summarize(result.findings)} · regex pass · low-confidence
            matches filtered
          </span>
        </div>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.rose}33`,
        }}
      >
        {result.findings.map((f, i) => (
          <FindingRow key={`${f.filePath}:${f.line}:${f.patternId}`} f={f} isFirst={i === 0} />
        ))}
        {result.truncated && (
          <div
            className="px-4 py-2 text-[11px] border-t"
            style={{ color: TOK.textMuted, borderColor: TOK.border }}
          >
            {result.truncated}
          </div>
        )}
      </div>

      <p className="text-[11px]" style={{ color: TOK.textMuted }}>
        Previews are redacted (first 6 + last 4 chars). If any of these
        are real production credentials, rotate them immediately and
        purge from git history with{" "}
        <span className="font-mono">git filter-repo</span>. Low-
        confidence matches in test fixtures and{" "}
        <span className="font-mono">.env.example</span> files are
        already filtered out.
      </p>
    </section>
  );
}

function FindingRow({
  f,
  isFirst,
}: {
  f: SecretFinding;
  isFirst: boolean;
}) {
  const style = SEVERITY_STYLES[f.severity];
  const { Icon } = style;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderTop: isFirst ? "none" : `1px solid ${TOK.border}`,
      }}
    >
      <div
        className="flex flex-col items-center justify-center shrink-0 rounded-lg px-2.5 py-1.5 min-w-[64px]"
        style={{
          background: style.bg,
          color: style.fg,
          border: `1px solid ${style.ring}`,
        }}
      >
        <Icon size={13} />
        <span className="text-[10px] uppercase tracking-wider mt-1 font-semibold">
          {style.label}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          className="text-sm font-medium"
          style={{ color: TOK.textPrimary }}
        >
          {f.patternLabel}
        </div>
        <div
          className="text-xs flex items-center gap-2 flex-wrap"
          style={{ color: TOK.textMuted }}
        >
          <span className="font-mono truncate" title={f.filePath}>
            {f.filePath}
          </span>
          <span>·</span>
          <span className="font-mono">line {f.line}</span>
          <span>·</span>
          <span className="font-mono" style={{ color: TOK.textSecondary }}>
            {f.preview}
          </span>
        </div>
      </div>
    </div>
  );
}
