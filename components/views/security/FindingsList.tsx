// FindingsList — unified, severity-sorted list of every finding
// across the three scanners (v0.81+, Design A redesign).
//
// Combines IncidentMatch, SecretFinding, RiskyPatternFinding into a
// single UnifiedFinding union, sorts by severity rank (high → low →
// info), and renders compact 2-line rows. Brain sees urgent items
// first regardless of which scanner emitted them.
//
// Per-row layout (Snyk/Dependabot-stil):
//
//   [SEVERITY · kind]  Title line                    [action link]
//                       Mono detail line
//
// Where:
//   incidents → title = incident name, detail = matched packages
//   secrets   → title = path:line, detail = redacted preview
//   patterns  → title = path:line, detail = source snippet

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { IncidentMatch } from "@/lib/security/knownIncidents";
import type { RiskyPatternFinding } from "@/lib/security/riskyPatterns";
import type { SecretFinding } from "@/lib/security/types";

type UnifiedFinding =
  | { kind: "incident"; severity: "high"; data: IncidentMatch }
  | {
      kind: "secret";
      severity: "high" | "medium" | "low";
      data: SecretFinding;
    }
  | { kind: "pattern"; severity: "info"; data: RiskyPatternFinding };

const SEVERITY_RANK: Record<UnifiedFinding["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

interface Props {
  incidentMatches: IncidentMatch[];
  secretFindings: SecretFinding[];
  patternFindings: RiskyPatternFinding[];
  sessionId: string;
}

export function FindingsList({
  incidentMatches,
  secretFindings,
  patternFindings,
  sessionId,
}: Props) {
  const all: UnifiedFinding[] = [
    ...incidentMatches.map(
      (m) => ({ kind: "incident", severity: "high", data: m }) as const,
    ),
    ...secretFindings.map(
      (s) =>
        ({
          kind: "secret",
          severity: s.severity,
          data: s,
        }) as UnifiedFinding,
    ),
    ...patternFindings.map(
      (p) => ({ kind: "pattern", severity: "info", data: p }) as const,
    ),
  ];

  // Stable sort by severity rank (high first). Array.prototype.sort
  // is stable in modern V8 / SpiderMonkey, so equal-rank items keep
  // input order (incidents → secrets → patterns).
  all.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  if (all.length === 0) {
    return <CleanListState />;
  }

  return (
    <section className="flex flex-col gap-3">
      <header
        className="flex items-baseline justify-between pb-2"
        style={{ borderBottom: `1px solid ${TOK.border}` }}
      >
        <h2
          className="text-base font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
        >
          Findings
          <span
            className="ml-2 text-xs font-mono"
            style={{ color: TOK.textMuted }}
          >
            {all.length}
          </span>
        </h2>
        <span
          className="text-[10px] uppercase tracking-[0.14em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Sorted by severity
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {all.map((f, i) => (
          <FindingRow key={rowKey(f, i)} finding={f} sessionId={sessionId} />
        ))}
      </div>
    </section>
  );
}

function rowKey(f: UnifiedFinding, fallbackIdx: number): string {
  if (f.kind === "incident") return `incident-${f.data.incident.id}`;
  if (f.kind === "secret") {
    return `secret-${f.data.filePath}-${f.data.line}-${fallbackIdx}`;
  }
  return `pattern-${f.data.filePath}-${f.data.line}-${fallbackIdx}`;
}

// ─── Row ─────────────────────────────────────────────────────────

function FindingRow({
  finding,
  sessionId,
}: {
  finding: UnifiedFinding;
  sessionId: string;
}) {
  return (
    <article
      className="flex items-start gap-3 px-4 py-3 rounded-lg"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <SeverityBadge severity={finding.severity} />
      <KindBadge kind={finding.kind} />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        {finding.kind === "incident" && (
          <IncidentRowContent data={finding.data} />
        )}
        {finding.kind === "secret" && (
          <SecretRowContent data={finding.data} sessionId={sessionId} />
        )}
        {finding.kind === "pattern" && (
          <PatternRowContent data={finding.data} sessionId={sessionId} />
        )}
      </div>
    </article>
  );
}

/** The file:line label, made a deep-link into the Source view at that line.
 *  Turns a dead evidence string into a jump-to-the-code affordance (audit
 *  Move F). Underline-on-hover + arrow so it reads as navigable. */
function SourcePathLink({
  sessionId,
  filePath,
  line,
}: {
  sessionId: string;
  filePath: string;
  line: number;
}) {
  return (
    <Link
      href={`/session/${sessionId}/source?file=${encodeURIComponent(filePath)}&line=${line}`}
      title={`Open ${filePath}:${line} in Source`}
      className="text-sm font-mono truncate inline-flex items-center gap-1 group/pl hover:underline"
      style={{ color: TOK.textPrimary }}
    >
      <span className="truncate">
        {filePath}:{line}
      </span>
      <ArrowUpRight
        size={12}
        className="flex-shrink-0 opacity-0 group-hover/pl:opacity-100 transition-opacity"
        style={{ color: TOK.textMuted }}
      />
    </Link>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: UnifiedFinding["severity"];
}) {
  const palette = severityPalette(severity);
  return (
    <span
      className="text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
      style={{
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        minWidth: 52,
        textAlign: "center",
      }}
    >
      {severity}
    </span>
  );
}

function KindBadge({ kind }: { kind: UnifiedFinding["kind"] }) {
  return (
    <span
      className="text-[9px] uppercase tracking-[0.14em] font-medium px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
      style={{
        background: "rgba(255,255,255,0.04)",
        color: TOK.textMuted,
        border: `1px solid ${TOK.border}`,
        minWidth: 58,
        textAlign: "center",
      }}
    >
      {kind}
    </span>
  );
}

function severityPalette(severity: UnifiedFinding["severity"]) {
  if (severity === "high") {
    return { bg: `${TOK.rose}1a`, text: TOK.rose, border: `${TOK.rose}40` };
  }
  if (severity === "medium") {
    return {
      bg: `${TOK.amber}1a`,
      text: TOK.amber,
      border: `${TOK.amber}40`,
    };
  }
  if (severity === "low") {
    return {
      bg: "rgba(255,255,255,0.04)",
      text: TOK.textSecondary,
      border: TOK.border,
    };
  }
  // info
  return {
    bg: "rgba(255,255,255,0.04)",
    text: TOK.textMuted,
    border: TOK.border,
  };
}

// ─── Per-kind row content ─────────────────────────────────────────

function IncidentRowContent({ data }: { data: IncidentMatch }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-sm font-semibold tracking-tight truncate"
          style={{ color: TOK.textPrimary }}
          title={data.incident.name}
        >
          {data.incident.name}
        </span>
        <a
          href={data.incident.reference}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline transition flex-shrink-0"
          style={{ color: TOK.accent }}
        >
          Read advisory
          <ArrowUpRight size={11} />
        </a>
      </div>
      <span
        className="text-xs font-mono truncate"
        style={{ color: TOK.textMuted }}
        title={data.matchedPackages.join(" · ")}
      >
        {data.matchedPackages.join(" · ")}
      </span>
    </>
  );
}

function SecretRowContent({
  data,
  sessionId,
}: {
  data: SecretFinding;
  sessionId: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <SourcePathLink sessionId={sessionId} filePath={data.filePath} line={data.line} />
        <span
          className="text-xs flex-shrink-0"
          style={{ color: TOK.textMuted }}
        >
          {data.patternLabel}
        </span>
      </div>
      <code
        className="text-xs font-mono px-2 py-0.5 rounded inline-block"
        style={{
          background: TOK.surfaceElevated,
          color: TOK.textSecondary,
          border: `1px solid ${TOK.border}`,
          width: "fit-content",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.preview}
      </code>
    </>
  );
}

function PatternRowContent({
  data,
  sessionId,
}: {
  data: RiskyPatternFinding;
  sessionId: string;
}) {
  const compactSnippet =
    data.snippet.length > 100
      ? data.snippet.slice(0, 100) + "…"
      : data.snippet;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <SourcePathLink sessionId={sessionId} filePath={data.filePath} line={data.line} />
        <span
          className="text-xs flex-shrink-0"
          style={{ color: TOK.textMuted }}
        >
          {data.patternName}
        </span>
      </div>
      <code
        className="text-xs font-mono"
        style={{ color: TOK.textSecondary }}
      >
        {compactSnippet}
      </code>
    </>
  );
}

// ─── Clean state ─────────────────────────────────────────────────

function CleanListState() {
  return (
    <div
      className="flex items-center gap-3 px-4 py-6 rounded-lg"
      style={{
        background: `${TOK.accent}0a`,
        border: `1px solid ${TOK.accent}33`,
      }}
    >
      <ShieldCheck
        size={18}
        style={{ color: TOK.accent, flexShrink: 0 }}
      />
      <div className="flex flex-col gap-0.5">
        <p
          className="text-sm font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          No findings across any scanner.
        </p>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          The three deterministic scanners ran on this snapshot and
          surfaced nothing actionable. Refreshing the session re-runs
          all of them.
        </p>
      </div>
    </div>
  );
}
