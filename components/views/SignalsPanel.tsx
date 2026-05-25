// SignalsPanel — three-column render of all signals returned by
// extractHealthSignals (v0.81+). Server-renderable (no client-only APIs
// used) so it slots into the /session/[id]/signals route without a
// "use client" boundary.
//
// Composition mirrors the data shape:
//   Working       — green column, positive signals
//   Needs Work    — rose column, risks/debt with severity badges
//   Open Questions— amber column, observations to interpret
//
// Per-signal card surfaces title + detail + severity + evidence
// (paths in mono, labeled numbers, optional note). The id is shown
// as a small caps eyebrow so visitors can map a card back to the
// detector in lib/signals.ts when curious.

import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { TOK } from "@/lib/theme";
import type { HealthSignal, HealthSignals } from "@/lib/types";

interface Props {
  signals: HealthSignals;
}

export function SignalsPanel({ signals }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Column
        title="Working"
        subtitle="positive signals — things going well"
        signals={signals.working}
        accent={TOK.accent}
        Icon={CheckCircle2}
      />
      <Column
        title="Needs Work"
        subtitle="risks, debt, regressions"
        signals={signals.needsWork}
        accent={TOK.rose}
        Icon={AlertTriangle}
      />
      <Column
        title="Open Questions"
        subtitle="observations needing human interpretation"
        signals={signals.questions}
        accent={TOK.amber}
        Icon={HelpCircle}
      />
    </div>
  );
}

interface ColumnProps {
  title: string;
  subtitle: string;
  signals: HealthSignal[];
  accent: string;
  Icon: LucideIcon;
}

function Column({ title, subtitle, signals, accent, Icon }: ColumnProps) {
  return (
    <section className="flex flex-col gap-3 min-w-0">
      <header className="flex flex-col gap-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon size={14} style={{ color: accent }} />
            <h2
              className="text-sm font-semibold tracking-tight"
              style={{ color: TOK.textPrimary }}
            >
              {title}
            </h2>
          </div>
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textMuted,
            }}
          >
            {signals.length}
          </span>
        </div>
        <p
          className="text-xs leading-relaxed"
          style={{ color: TOK.textMuted }}
        >
          {subtitle}
        </p>
      </header>

      {signals.length === 0 ? (
        <div
          className="flex flex-col gap-1 px-4 py-6 rounded-lg text-center"
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: `1px dashed ${TOK.border}`,
          }}
        >
          <p className="text-xs" style={{ color: TOK.textMuted }}>
            No signals in this category for this snapshot.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {signals.map((sig) => (
            <SignalCard key={sig.id} signal={sig} columnAccent={accent} />
          ))}
        </div>
      )}
    </section>
  );
}

interface SignalCardProps {
  signal: HealthSignal;
  columnAccent: string;
}

function SignalCard({ signal, columnAccent }: SignalCardProps) {
  return (
    <article
      className="flex flex-col gap-2.5 p-4 rounded-lg"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.12em] font-mono"
          style={{ color: TOK.textMuted }}
        >
          {signal.id}
        </span>
        {signal.severity && <SeverityBadge severity={signal.severity} />}
      </header>

      <h3
        className="text-sm font-semibold tracking-tight"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
      >
        {signal.title}
      </h3>

      <p
        className="text-xs leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        {signal.detail}
      </p>

      <Evidence evidence={signal.evidence} columnAccent={columnAccent} />
    </article>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "low" | "medium" | "high";
}) {
  // Map severity to the existing TOK palette. high = rose, medium = amber,
  // low = muted neutral. Keeps colors in sync with the rest of the app
  // without introducing new tokens.
  const palette =
    severity === "high"
      ? { bg: `${TOK.rose}1a`, text: TOK.rose, border: `${TOK.rose}40` }
      : severity === "medium"
        ? { bg: `${TOK.amber}1a`, text: TOK.amber, border: `${TOK.amber}40` }
        : {
            bg: "rgba(255,255,255,0.04)",
            text: TOK.textMuted,
            border: TOK.border,
          };
  return (
    <span
      className="text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded"
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

interface EvidenceProps {
  evidence: HealthSignal["evidence"];
  columnAccent: string;
}

function Evidence({ evidence, columnAccent }: EvidenceProps) {
  const hasPaths = (evidence.paths?.length ?? 0) > 0;
  const numberEntries = Object.entries(evidence.numbers ?? {});
  const hasNumbers = numberEntries.length > 0;
  const hasNote = !!evidence.note;
  if (!hasPaths && !hasNumbers && !hasNote) return null;

  return (
    <div
      className="flex flex-col gap-2 pt-2.5"
      style={{ borderTop: `1px solid ${TOK.border}` }}
    >
      {hasPaths && evidence.paths && (
        <div className="flex flex-col gap-1">
          <span
            className="text-[9px] uppercase tracking-[0.14em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Evidence — paths
          </span>
          <ul className="flex flex-col gap-0.5">
            {evidence.paths.map((p, i) => (
              <li
                key={`${p}-${i}`}
                className="text-[11px] font-mono truncate"
                style={{ color: TOK.textSecondary }}
                title={p}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasNumbers && (
        <div className="flex flex-col gap-1">
          <span
            className="text-[9px] uppercase tracking-[0.14em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Numbers
          </span>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {numberEntries.map(([key, value]) => (
              <div key={key} className="flex flex-col">
                <dt
                  className="text-[10px]"
                  style={{ color: TOK.textMuted }}
                >
                  {humanizeKey(key)}
                </dt>
                <dd
                  className="text-xs font-mono font-semibold"
                  style={{ color: columnAccent }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {hasNote && evidence.note && (
        <p
          className="text-[11px] italic leading-snug"
          style={{ color: TOK.textMuted }}
        >
          {evidence.note}
        </p>
      )}
    </div>
  );
}

/** Camel-case key → human-readable label. Keeps detector code free of
 *  UI concerns while letting users read the evidence without translating
 *  pctUntested / maxDepth themselves. */
function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
