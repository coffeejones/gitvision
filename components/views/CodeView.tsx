// Presentational read-only code renderer for the Source view. Takes already-
// highlighted lines (from lib/highlight) plus the annotation layer (file chips +
// per-function markers, from lib/sourceAnnotations) and draws:
//   · a chips bar of the file's deterministic findings,
//   · the code with a sticky line-number gutter,
//   · a complexity marker in the gutter at each non-trivial function's start line.
// Pure render — no fetching, no highlighting — so it's harness-/snapshot-friendly.

import { useMemo } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  FlaskConical,
  Flame,
  ArrowLeftToLine,
  Copy,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { CodeLines } from "@/lib/highlight";
import {
  complexityTone,
  type FileChips,
  type FnMarker,
} from "@/lib/sourceAnnotations";

const LINE_HEIGHT = 20;
const GUTTER_NUM = 52;
const GUTTER_MARK = 34;

export function CodeView({
  path,
  lines,
  aligned,
  lang,
  chips,
  functions = [],
}: {
  path: string;
  lines: CodeLines;
  aligned: boolean;
  lang: string | null;
  chips?: FileChips | null;
  functions?: FnMarker[];
}) {
  // Map displayed line (startRow + 1) → the highest-complexity function starting
  // there, but only if it clears the "worth a marker" threshold.
  const markerByLine = useMemo(() => {
    const m = new Map<number, FnMarker>();
    for (const fn of functions) {
      if (complexityTone(fn.complexity) === null) continue;
      const line = fn.startRow + 1;
      const prev = m.get(line);
      if (!prev || fn.complexity > prev.complexity) m.set(line, fn);
    }
    return m;
  }, [functions]);

  return (
    <div className="flex flex-col min-w-0">
      {/* File header — path + language. */}
      <div
        className="flex items-center gap-3 px-4 h-10 flex-shrink-0"
        style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
      >
        <span
          className="text-[12.5px] font-medium truncate"
          style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}
        >
          {path}
        </span>
        {lang && (
          <span
            className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: TOK.textMuted, background: "rgba(255,255,255,0.04)" }}
          >
            {lang}
          </span>
        )}
      </div>

      {/* Chips bar — the file's deterministic findings. */}
      {chips && <ChipsBar chips={chips} />}

      {/* Drift banner — the fetched bytes don't hash to what we analyzed. */}
      {!aligned && (
        <div
          className="flex items-start gap-2 px-4 py-2 text-[12px] flex-shrink-0"
          style={{ background: "rgba(210,153,34,0.08)", color: TOK.amber, borderBottom: `1px solid ${TOK.border}` }}
        >
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            This file changed since we analyzed it — showing the current source,
            but line-anchored markers are hidden. Refresh the session to re-align.
          </span>
        </div>
      )}

      {/* Code — one horizontal scroll region; the gutter sticks left. */}
      <div className="overflow-x-auto" style={{ background: TOK.surface }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
          {lines.map((toks, i) => {
            const lineNo = i + 1;
            const marker = aligned ? markerByLine.get(lineNo) : undefined;
            return (
              <div
                key={i}
                className="flex items-stretch"
                style={{ minWidth: "max-content", height: LINE_HEIGHT }}
              >
                <span
                  className="text-right select-none flex-shrink-0"
                  style={{
                    position: "sticky",
                    left: 0,
                    width: GUTTER_NUM,
                    paddingRight: 12,
                    color: TOK.textMuted,
                    background: TOK.surface,
                    lineHeight: `${LINE_HEIGHT}px`,
                  }}
                >
                  {lineNo}
                </span>
                <span
                  className="flex items-center justify-center select-none flex-shrink-0"
                  style={{ width: GUTTER_MARK, background: TOK.surface, position: "sticky", left: GUTTER_NUM }}
                >
                  {marker && <ComplexityMarker fn={marker} />}
                </span>
                <code style={{ whiteSpace: "pre", lineHeight: `${LINE_HEIGHT}px`, paddingRight: 24 }}>
                  {toks.length === 0 ? (
                    "​"
                  ) : (
                    toks.map((t, j) => (
                      <span key={j} style={t.color ? { color: t.color } : undefined}>
                        {t.content}
                      </span>
                    ))
                  )}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────

function ChipsBar({ chips }: { chips: FileChips }) {
  const items: React.ReactNode[] = [];

  // Refactor-safety tier — only the two that warrant attention.
  if (chips.tier === "load-bearing") {
    items.push(
      <Chip
        key="tier"
        icon={<ShieldAlert size={12} />}
        tone="bad"
        label="Load-bearing"
        title={`A change here ripples widely${chips.fanIn ? ` — ${chips.fanIn} files depend on it directly` : ""}. Touch with a test in hand.`}
      />,
    );
  } else if (chips.tier === "handle-with-care") {
    items.push(
      <Chip
        key="tier"
        icon={<ShieldAlert size={12} />}
        tone="warn"
        label="Handle with care"
        title="Change carefully — earned by fan-in, complexity, or structural duplication. The evidence chips here show the specific reason."
      />,
    );
  }

  // Test reach — flag the untested risk; note the tested case quietly.
  if (!chips.isTest && chips.tested === false) {
    items.push(
      <Chip
        key="test"
        icon={<FlaskConical size={12} />}
        tone="warn"
        label="No test guards this"
        title="No test file imports or calls into this file — a regression here won't be caught."
      />,
    );
  } else if (!chips.isTest && chips.tested === true) {
    items.push(
      <Chip
        key="test"
        icon={<FlaskConical size={12} />}
        tone="ok"
        label="Tested"
        title="At least one test file reaches this file (static import/call mapping, not a coverage %)."
      />,
    );
  }

  // Churn + authors (bus factor).
  if (chips.churn != null && chips.churn > 0) {
    const solo = chips.authors === 1;
    items.push(
      <Chip
        key="churn"
        icon={<Flame size={12} />}
        tone={solo ? "bad" : "neutral"}
        label={`${chips.churn} commit${chips.churn === 1 ? "" : "s"} · ${chips.authors ?? "?"} author${chips.authors === 1 ? "" : "s"}`}
        title={
          solo
            ? "Bus factor 1: a single author has touched this file. Knowledge here is concentrated."
            : "Commits touching this file and the number of distinct authors, from the sampled history."
        }
      />,
    );
  }

  // Fan-in.
  if (chips.fanIn > 0) {
    items.push(
      <Chip
        key="fanin"
        icon={<ArrowLeftToLine size={12} />}
        tone="neutral"
        label={`${chips.fanIn} dependent${chips.fanIn === 1 ? "" : "s"}`}
        title={`${chips.fanIn} file${chips.fanIn === 1 ? "" : "s"} import or call into this one${chips.untestedDependents > 0 ? ` — ${chips.untestedDependents} of them with no test to catch a break` : ""}.`}
      />,
    );
  }

  // Structural duplication.
  if (chips.duplicatedFns > 0) {
    items.push(
      <Chip
        key="dupe"
        icon={<Copy size={12} />}
        tone="neutral"
        label={`${chips.duplicatedFns} duplicated`}
        title={`${chips.duplicatedFns} function${chips.duplicatedFns === 1 ? "" : "s"} in this file are structurally duplicated elsewhere — change one copy and the others drift.`}
      />,
    );
  }

  if (items.length === 0) return null;
  return (
    <div
      className="flex items-center gap-2 flex-wrap px-4 py-2 flex-shrink-0"
      style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surface }}
    >
      {items}
    </div>
  );
}

const TONE_COLOR: Record<string, string> = {
  bad: TOK.rose,
  warn: TOK.amber,
  ok: TOK.textSecondary,
  neutral: TOK.textMuted,
};

function Chip({
  icon,
  tone,
  label,
  title,
}: {
  icon: React.ReactNode;
  tone: "bad" | "warn" | "ok" | "neutral";
  label: string;
  title: string;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md cursor-default"
      style={{ color, background: "rgba(255,255,255,0.03)", border: `1px solid ${TOK.border}` }}
    >
      <span className="flex-shrink-0" style={{ color }}>
        {icon}
      </span>
      {label}
    </span>
  );
}

function ComplexityMarker({ fn }: { fn: FnMarker }) {
  const tone = complexityTone(fn.complexity);
  const color = tone === "high" ? TOK.rose : TOK.amber;
  return (
    <span
      title={`${fn.name || "(anonymous)"} · complexity ${fn.complexity}`}
      className="text-[9px] font-semibold leading-none rounded px-1 py-0.5 cursor-default"
      style={{ color, background: "rgba(255,255,255,0.05)", fontFamily: "var(--font-mono)" }}
    >
      {fn.complexity}
    </span>
  );
}
