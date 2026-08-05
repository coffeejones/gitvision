"use client";

// SignalsPanel — interactive three-column render of every signal
// returned by extractHealthSignals (v0.81+). Now with filter/search
// (v0.81 polish): instant fuzzy match on title/id/detail + severity
// pills that hide cards without that severity.
//
// Composition mirrors extractHealthSignals' return shape:
//   Working       — green column, positive signals
//   Needs Work    — rose column, risks/debt with severity badges
//   Open Questions— amber column, observations to interpret
//
// Filtering is client-side, instant — there are max ~25 cards so we
// don't need debouncing or virtualization. Filtered state is local
// to this component; refreshing the page resets.
//
// Severity pills only meaningfully affect Needs Work (the bucket
// where severity is set). Working and Open Questions cards have
// no severity and pass the severity filter unconditionally — the
// query text filter still applies to them.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { HealthSignal, HealthSignals } from "@/lib/types";
import { TermInfo } from "@/components/TermInfo";
import type { GlossaryKey } from "@/lib/glossary";

// Signal ids whose concept has a glossary "what/why". The card title already
// says WHAT fired; TermInfo adds the plain-language meaning + downstream impact
// (Rick Segal's ask). Only the jargon-heavy ones — self-evident signals
// (e.g. "very-active") get nothing, on purpose.
const SIGNAL_TERMS: Partial<Record<string, GlossaryKey>> = {
  "untested-hotspots": "untested-hotspot",
  "bus-factor-risk": "bus-factor",
  "deep-dependency-chains": "import-depth",
  "cross-boundary-coupling": "cross-boundary",
};

interface Props {
  signals: HealthSignals;
}

type Severity = "high" | "medium" | "low";
const ALL_SEVERITIES: ReadonlyArray<Severity> = ["high", "medium", "low"];

export function SignalsPanel({ signals }: Props) {
  const [query, setQuery] = useState("");
  const [activeSeverities, setActiveSeverities] = useState<Set<Severity>>(
    () => new Set(ALL_SEVERITIES),
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // '/' focuses the search box (dev convention — works in GitHub,
  // Linear, Slack, etc.). We bail when the user is already typing
  // in an input so '/' inside text fields isn't intercepted.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = target?.getAttribute("contenteditable") === "true";
      if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Apply filters. Memoize per (query, activeSeverities, signals)
  // so re-renders triggered by other state (e.g. focus) don't redo
  // the work. At this catalog size it's cheap regardless, but the
  // explicit useMemo also documents the dependency.
  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const matches = (sig: HealthSignal): boolean => {
      // Severity gate — only applies when the signal has one.
      if (sig.severity && !activeSeverities.has(sig.severity)) return false;
      // Text gate — empty query passes through.
      if (!lowerQuery) return true;
      return (
        sig.title.toLowerCase().includes(lowerQuery) ||
        sig.id.toLowerCase().includes(lowerQuery) ||
        sig.detail.toLowerCase().includes(lowerQuery)
      );
    };
    return {
      working: signals.working.filter(matches),
      needsWork: signals.needsWork.filter(matches),
      questions: signals.questions.filter(matches),
    };
  }, [signals, query, activeSeverities]);

  const totalOriginal =
    signals.working.length +
    signals.needsWork.length +
    signals.questions.length;
  const totalFiltered =
    filtered.working.length +
    filtered.needsWork.length +
    filtered.questions.length;
  const isFiltering =
    query.length > 0 || activeSeverities.size < ALL_SEVERITIES.length;

  function toggleSeverity(sev: Severity) {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setActiveSeverities(new Set(ALL_SEVERITIES));
    searchRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        activeSeverities={activeSeverities}
        onToggleSeverity={toggleSeverity}
        totalOriginal={totalOriginal}
        totalFiltered={totalFiltered}
        isFiltering={isFiltering}
        onClear={clearFilters}
        searchRef={searchRef}
      />

      {totalFiltered === 0 && isFiltering ? (
        <EmptyFilterState query={query} onClear={clearFilters} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Column
            title="Working"
            subtitle="positive signals — things going well"
            signals={filtered.working}
            accent={TOK.accent}
            Icon={CheckCircle2}
          />
          <Column
            title="Needs Work"
            subtitle="risks, debt, regressions"
            signals={filtered.needsWork}
            accent={TOK.rose}
            Icon={AlertTriangle}
          />
          <Column
            title="Open Questions"
            subtitle="observations needing human interpretation"
            signals={filtered.questions}
            accent={TOK.amber}
            Icon={HelpCircle}
          />
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ──────────────────────────────────────────────────────

interface FilterBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  activeSeverities: Set<Severity>;
  onToggleSeverity: (s: Severity) => void;
  totalOriginal: number;
  totalFiltered: number;
  isFiltering: boolean;
  onClear: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

function FilterBar({
  query,
  onQueryChange,
  activeSeverities,
  onToggleSeverity,
  totalOriginal,
  totalFiltered,
  isFiltering,
  onClear,
  searchRef,
}: FilterBarProps) {
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        onQueryChange("");
      } else {
        (e.target as HTMLInputElement).blur();
      }
    }
  }

  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-5"
      style={{ borderBottom: `1px solid ${TOK.border}` }}
    >
      {/* Search input */}
      <div className="relative flex-1 sm:max-w-md">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: TOK.textMuted }}
        />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search signals…  (press /)"
          aria-label="Search signals"
          className="w-full h-9 pl-9 pr-3 rounded-md text-sm focus:outline-none transition"
          style={{
            background: TOK.surface,
            border: `1px solid ${TOK.border}`,
            color: TOK.textPrimary,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = TOK.borderStrong;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = TOK.border;
          }}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Severity toggle pills */}
        <span
          className="text-[10px] uppercase tracking-[0.14em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Severity
        </span>
        {ALL_SEVERITIES.map((sev) => (
          <SeverityPill
            key={sev}
            severity={sev}
            active={activeSeverities.has(sev)}
            onClick={() => onToggleSeverity(sev)}
          />
        ))}

        {/* Counter */}
        <span
          className="text-xs ml-2 font-mono"
          style={{ color: TOK.textMuted }}
        >
          {isFiltering
            ? `${totalFiltered} / ${totalOriginal}`
            : `${totalOriginal} signals`}
        </span>

        {/* Clear button — only when filtering */}
        {isFiltering && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs hover:underline transition"
            style={{ color: TOK.textMuted }}
          >
            <X size={11} />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function SeverityPill({
  severity,
  active,
  onClick,
}: {
  severity: Severity;
  active: boolean;
  onClick: () => void;
}) {
  const palette = severityPalette(severity);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded transition"
      style={{
        background: active ? palette.bg : "transparent",
        color: active ? palette.text : TOK.textMuted,
        border: `1px solid ${active ? palette.border : TOK.border}`,
        opacity: active ? 1 : 0.6,
      }}
    >
      {severity}
    </button>
  );
}

// ─── Empty state when filters yield no matches ───────────────────────

function EmptyFilterState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-16 px-4 text-center rounded-lg"
      style={{
        background: "rgba(255, 255, 255, 0.02)",
        border: `1px dashed ${TOK.border}`,
      }}
    >
      <p className="text-sm" style={{ color: TOK.textSecondary }}>
        {query
          ? `No signals match "${query}".`
          : "No signals match the current filters."}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-xs hover:underline transition"
        style={{ color: TOK.accent }}
      >
        Clear filters
      </button>
    </div>
  );
}

// ─── Column + cards ──────────────────────────────────────────────────

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
            No signals in this category.
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
        className="text-sm font-semibold tracking-tight inline-flex items-center gap-1.5"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
      >
        {signal.title}
        {SIGNAL_TERMS[signal.id] && <TermInfo term={SIGNAL_TERMS[signal.id]!} />}
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

function SeverityBadge({ severity }: { severity: Severity }) {
  const palette = severityPalette(severity);
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

/** Shared severity → color palette used by both the inert SeverityBadge
 *  on cards and the interactive SeverityPill in the filter bar. Keeps
 *  the two visually identical so users learn the color mapping once. */
function severityPalette(severity: Severity): {
  bg: string;
  text: string;
  border: string;
} {
  if (severity === "high") {
    return { bg: `${TOK.rose}1a`, text: TOK.rose, border: `${TOK.rose}40` };
  }
  if (severity === "medium") {
    return { bg: `${TOK.amber}1a`, text: TOK.amber, border: `${TOK.amber}40` };
  }
  return {
    bg: "rgba(255,255,255,0.04)",
    text: TOK.textMuted,
    border: TOK.border,
  };
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
