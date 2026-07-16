// Presentational read-only code renderer for the Source view. Takes already-
// highlighted lines (from lib/highlight) plus the annotation layer (file chips +
// per-function markers, from lib/sourceAnnotations) and draws:
//   · a chips bar of the file's deterministic findings,
//   · the code with a sticky line-number gutter,
//   · a complexity marker in the gutter at each non-trivial function's start line.
// Pure render — no fetching, no highlighting — so it's harness-/snapshot-friendly.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ShieldAlert,
  FlaskConical,
  Flame,
  ArrowLeftToLine,
  Copy,
  Link2,
  Check,
  Zap,
  History,
  Pencil,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Waypoints,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { CodeLines } from "@/lib/highlight";
import {
  complexityTone,
  type FileChips,
  type FnMarker,
} from "@/lib/sourceAnnotations";
import { FunctionInsight, type InsightResult } from "./FunctionInsight";

const LINE_HEIGHT = 20;
const GUTTER_NUM = 52;
const GUTTER_MARK = 34;

export function CodeView({
  sessionId,
  path,
  lines,
  aligned,
  lang,
  chips,
  functions = [],
  focusLine,
  onEdit,
  repoPrivate = false,
}: {
  /** When set, the header shows the Simulate + copy-link actions. */
  sessionId?: string;
  path: string;
  lines: CodeLines;
  aligned: boolean;
  lang: string | null;
  chips?: FileChips | null;
  functions?: FnMarker[];
  /** 1-indexed line to scroll to + highlight (from a ?line= deep-link). */
  focusLine?: number | null;
  /** Enter the what-if editor for this file. Shown as a header action. */
  onEdit?: () => void;
  /** Private-repo source → the AI explainer asks for a one-time consent first. */
  repoPrivate?: boolean;
}) {
  // Copy a shareable deep-link to the file (or a specific line). `copied` holds
  // the tag of whatever was last copied so we can flash confirmation.
  const [copied, setCopied] = useState<string | null>(null);
  function copyLink(tag: string, line?: number) {
    if (typeof window === "undefined" || !sessionId) return;
    const q = `?file=${encodeURIComponent(path)}${line ? `&line=${line}` : ""}`;
    void navigator.clipboard?.writeText(`${window.location.origin}/session/${sessionId}/source${q}`);
    setCopied(tag);
    window.setTimeout(() => setCopied((t) => (t === tag ? null : t)), 1500);
  }
  // Scroll the deep-linked line into view once its content is rendered. We can't
  // use el.scrollIntoView(): the code block is `overflow-x: auto`, which the CSS
  // spec promotes to a vertical scroll container too — so scrollIntoView "traps"
  // on it (it has no vertical overflow, so it never scrolls) and never reaches
  // the real scroll pane. Instead we find the nearest ancestor that actually
  // scrolls vertically and centre the line in it ourselves.
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = focusRef.current;
    if (!focusLine || !el) return;
    // Two frames: an effect fires before the browser has settled the final
    // layout (line heights), so a one-frame measurement lands short. We also
    // can't use el.scrollIntoView() — the code block is `overflow-x: auto`,
    // which the spec promotes to a vertical scroll container; scrollIntoView
    // then "traps" on it (no vertical overflow, never scrolls) and never
    // reaches the real pane. So find the nearest ancestor that actually scrolls
    // vertically and centre the line in it ourselves.
    const t = setTimeout(() => {
      let sc = el.parentElement;
      while (sc) {
        const oy = getComputedStyle(sc).overflowY;
        if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight) break;
        sc = sc.parentElement;
      }
      if (!sc) return;
      const r = el.getBoundingClientRect();
      const delta = r.top - sc.getBoundingClientRect().top - sc.clientHeight / 2 + r.height / 2;
      sc.scrollTop += delta; // jump (not smooth): land the reader on the line at once
    }, 80);
    return () => clearTimeout(t);
  }, [focusLine, lines]);

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

  // "Since last visit": every line inside a changed function's range gets a
  // gutter change-bar; the count feeds a header chip.
  const { changeByLine, changedCount } = useMemo(() => {
    const map = new Map<number, "new" | "modified">();
    let count = 0;
    for (const fn of functions) {
      if (!fn.changed) continue;
      count++;
      for (let ln = fn.startRow + 1; ln <= fn.endRow + 1; ln++) map.set(ln, fn.changed);
    }
    return { changeByLine: map, changedCount: count };
  }, [functions]);

  // Structural-duplicate navigation: functions in this file that have a twin
  // elsewhere. Feeds a clickable chip → the twins panel.
  const dupeFns = useMemo(() => functions.filter((f) => f.duplicates?.length), [functions]);
  const [dupesOpen, setDupesOpen] = useState(false);
  useEffect(() => setDupesOpen(false), [path]);

  // Hub functions — called from many places, so a signature change ripples. >=3
  // callers keeps it to genuine hubs (most functions are called once or twice).
  const hubFns = useMemo(
    () => functions.filter((f) => (f.callers?.length ?? 0) >= 3),
    [functions],
  );
  const [callersOpen, setCallersOpen] = useState(false);
  useEffect(() => setCallersOpen(false), [path]);

  // AI explainer: which function's inline insight panel is open (its displayed
  // line), plus a per-session cache of loaded results so re-opening is instant.
  const [openInsight, setOpenInsight] = useState<number | null>(null);
  const [insights, setInsights] = useState<Map<number, InsightResult>>(new Map());
  useEffect(() => {
    setOpenInsight(null);
    setInsights(new Map());
  }, [path]);

  // The function whose insight is open (only complexity-marked functions can be
  // explained), and the 0-indexed line to split the code around so the panel
  // spans full width outside the horizontal scroll.
  const openMarker =
    openInsight != null && aligned && sessionId ? markerByLine.get(openInsight) : undefined;
  const splitIdx = openMarker ? openInsight! - 1 : null;

  // One code line, gutter + marker + syntax. Extracted so it can render into
  // either half of a split (around an open insight panel) with the right
  // absolute line index.
  const renderRow = (toks: CodeLines[number], i: number) => {
    const lineNo = i + 1;
    const marker = aligned ? markerByLine.get(lineNo) : undefined;
    const change = aligned ? changeByLine.get(lineNo) : undefined;
    // git-gutter semantics: green = added, blue = modified.
    const changeColor =
      change === "new" ? "#3fb950" : change === "modified" ? "#58a6ff" : "transparent";
    const focused = !!focusLine && lineNo === focusLine;
    const bg = focused ? "rgba(255,255,255,0.07)" : TOK.surface;
    return (
      <div
        key={i}
        id={`L${lineNo}`}
        ref={focused ? focusRef : undefined}
        className="flex items-stretch"
        style={{ minWidth: "max-content", height: LINE_HEIGHT, background: bg }}
      >
        <span
          className="text-right select-none flex-shrink-0"
          onClick={sessionId ? () => copyLink(`L${lineNo}`, lineNo) : undefined}
          title={
            [
              change && `${change} since last sweep`,
              sessionId && `Copy link to line ${lineNo}`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          style={{
            position: "sticky",
            left: 0,
            width: GUTTER_NUM,
            paddingRight: 12,
            borderLeft: `2px solid ${changeColor}`,
            color:
              copied === `L${lineNo}`
                ? TOK.accent
                : focused
                  ? TOK.textSecondary
                  : TOK.textMuted,
            background: bg,
            lineHeight: `${LINE_HEIGHT}px`,
            cursor: sessionId ? "pointer" : undefined,
          }}
        >
          {lineNo}
        </span>
        <span
          className="flex items-center justify-center select-none flex-shrink-0"
          style={{ width: GUTTER_MARK, background: bg, position: "sticky", left: GUTTER_NUM }}
        >
          {marker && (
            <ComplexityMarker
              fn={marker}
              onExplain={sessionId ? () => setOpenInsight((o) => (o === lineNo ? null : lineNo)) : undefined}
              open={openInsight === lineNo}
            />
          )}
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
  };

  const mono = { fontFamily: "var(--font-mono)", fontSize: 12.5 } as const;

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
        {sessionId && (
          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
            {onEdit && aligned && (
              <button
                type="button"
                onClick={onEdit}
                title="Edit this file in a scratch buffer and simulate what your change breaks"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition hover:bg-white/5"
                style={{ color: TOK.accent }}
              >
                <Pencil size={12} /> What if?
              </button>
            )}
            <button
              type="button"
              onClick={() => copyLink("file")}
              title="Copy a link to this file"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition hover:bg-white/5"
              style={{ color: TOK.textMuted }}
            >
              {copied === "file" ? <Check size={12} /> : <Link2 size={12} />}
              {copied === "file" ? "Copied" : "Copy link"}
            </button>
            <Link
              href={`/session/${sessionId}/faultline?file=${encodeURIComponent(path)}`}
              title="Simulate deleting this file in Faultline"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition hover:bg-white/5"
              style={{ color: TOK.textMuted }}
            >
              <Zap size={12} /> Simulate deleting
            </Link>
          </div>
        )}
      </div>

      {/* Chips bar — the file's deterministic findings. */}
      {chips && (
        <ChipsBar
          chips={chips}
          changedCount={changedCount}
          dupeCount={dupeFns.length}
          dupesOpen={dupesOpen}
          onToggleDupes={() => setDupesOpen((o) => !o)}
          hubCount={hubFns.length}
          callersOpen={callersOpen}
          onToggleCallers={() => setCallersOpen((o) => !o)}
        />
      )}

      {/* Twin navigation — the duplicated functions in this file + where their
          structurally-identical copies live. */}
      {dupesOpen && sessionId && dupeFns.length > 0 && (
        <DuplicatesPanel sessionId={sessionId} fns={dupeFns} />
      )}

      {/* Hub functions — where each is called from, so you know what a signature
          change ripples into. */}
      {callersOpen && sessionId && hubFns.length > 0 && (
        <CallersPanel sessionId={sessionId} fns={hubFns} />
      )}

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

      {/* Code — the gutter sticks left in each horizontal scroll region. When a
          function's AI insight is open, the code splits around its start line so
          the panel spans full width, outside the horizontal scroll. */}
      <div style={{ background: TOK.surface }}>
        {splitIdx == null || !openMarker ? (
          <div className="overflow-x-auto">
            <div style={mono}>{lines.map((toks, i) => renderRow(toks, i))}</div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div style={mono}>
                {lines.slice(0, splitIdx + 1).map((toks, i) => renderRow(toks, i))}
              </div>
            </div>
            <FunctionInsight
              // Remount when the target function changes — otherwise switching
              // straight from one open insight to another keeps the first's
              // fetched state (useState/effect run only on mount).
              key={`${path}:${openInsight}`}
              sessionId={sessionId!}
              path={path}
              marker={openMarker}
              repoPrivate={repoPrivate}
              initial={insights.get(openInsight!)}
              onLoaded={(r) => setInsights((m) => new Map(m).set(openInsight!, r))}
              onClose={() => setOpenInsight(null)}
            />
            <div className="overflow-x-auto">
              <div style={mono}>
                {lines
                  .slice(splitIdx + 1)
                  .map((toks, i) => renderRow(toks, splitIdx + 1 + i))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────

function ChipsBar({
  chips,
  changedCount = 0,
  dupeCount = 0,
  dupesOpen = false,
  onToggleDupes,
  hubCount = 0,
  callersOpen = false,
  onToggleCallers,
}: {
  chips: FileChips;
  changedCount?: number;
  dupeCount?: number;
  dupesOpen?: boolean;
  onToggleDupes?: () => void;
  hubCount?: number;
  callersOpen?: boolean;
  onToggleCallers?: () => void;
}) {
  const items: React.ReactNode[] = [];

  // The "update angle" leads: what changed here since the last sweep.
  if (changedCount > 0) {
    items.push(
      <Chip
        key="changed"
        icon={<History size={12} />}
        tone="accent"
        label={`${changedCount} changed since last sweep`}
        title={`${changedCount} function${changedCount === 1 ? "" : "s"} in this file are new or modified since the previous snapshot — the gutter bars mark them.`}
      />,
    );
  }

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

  // Structural duplication — clickable: opens the twin-navigation panel.
  if (dupeCount > 0 && onToggleDupes) {
    items.push(
      <button
        key="dupe"
        type="button"
        onClick={onToggleDupes}
        title={`${dupeCount} function${dupeCount === 1 ? "" : "s"} here have a structurally identical copy elsewhere — click to see where. Change one and the others drift.`}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md transition hover:bg-white/[0.04] cursor-pointer"
        style={{
          color: dupesOpen ? TOK.textPrimary : TOK.textMuted,
          background: dupesOpen ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${TOK.border}`,
        }}
      >
        <Copy size={12} />
        {dupeCount} with a twin
        {dupesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>,
    );
  }

  // Hub functions — clickable: opens the "called from" panel.
  if (hubCount > 0 && onToggleCallers) {
    items.push(
      <button
        key="hubs"
        type="button"
        onClick={onToggleCallers}
        title={`${hubCount} function${hubCount === 1 ? "" : "s"} here are called from many places — click to see where. Changing their signature ripples widely.`}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md transition hover:bg-white/[0.04] cursor-pointer"
        style={{
          color: callersOpen ? TOK.textPrimary : TOK.textMuted,
          background: callersOpen ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${TOK.border}`,
        }}
      >
        <Waypoints size={12} />
        {hubCount} hub function{hubCount === 1 ? "" : "s"}
        {callersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>,
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

// ─── Twin navigation ────────────────────────────────────────────────────────

function DuplicatesPanel({ sessionId, fns }: { sessionId: string; fns: FnMarker[] }) {
  return (
    <div
      className="px-4 py-3 flex flex-col gap-3 flex-shrink-0"
      style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
    >
      {fns.map((f, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}>
            <span style={{ color: TOK.textMuted }}>ƒ</span> {f.name || "(anonymous)"}
            <span className="ml-1.5 text-[11px]" style={{ color: TOK.textMuted }}>
              L{f.startRow + 1} · {f.duplicates!.length} twin{f.duplicates!.length === 1 ? "" : "s"}
            </span>
          </span>
          <div className="flex flex-col gap-0.5 pl-3.5">
            {f.duplicates!.map((d, j) => (
              <Link
                key={j}
                href={`/session/${sessionId}/source?file=${encodeURIComponent(d.path)}&line=${d.line}`}
                className="inline-flex items-center gap-1 text-[12px] self-start transition hover:opacity-80"
                style={{ color: TOK.accent, fontFamily: "var(--font-mono)" }}
              >
                <CornerDownRight size={11} className="flex-shrink-0" /> {d.path}:{d.line}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Call-site navigation (function-level fan-in) ───────────────────────────

function CallersPanel({ sessionId, fns }: { sessionId: string; fns: FnMarker[] }) {
  return (
    <div
      className="px-4 py-3 flex flex-col gap-3 flex-shrink-0"
      style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
    >
      {fns.map((f, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}>
            <span style={{ color: TOK.textMuted }}>ƒ</span> {f.name || "(anonymous)"}
            <span className="ml-1.5 text-[11px]" style={{ color: TOK.textMuted }}>
              L{f.startRow + 1} · called from {f.callers!.length} place{f.callers!.length === 1 ? "" : "s"}
            </span>
          </span>
          <div className="flex flex-col gap-0.5 pl-3.5">
            {f.callers!.map((c, j) => (
              <Link
                key={j}
                href={
                  c.line
                    ? `/session/${sessionId}/source?file=${encodeURIComponent(c.path)}&line=${c.line}`
                    : `/session/${sessionId}/source?file=${encodeURIComponent(c.path)}`
                }
                className="inline-flex items-center gap-1 text-[12px] self-start transition hover:opacity-80"
                style={{ color: TOK.accent, fontFamily: "var(--font-mono)" }}
              >
                <CornerDownRight size={11} className="flex-shrink-0" />
                {c.path}
                {c.fn ? ` · ${c.fn}()` : " · module scope"}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const TONE_COLOR: Record<string, string> = {
  bad: TOK.rose,
  warn: TOK.amber,
  ok: TOK.textSecondary,
  neutral: TOK.textMuted,
  accent: TOK.accent,
};

function Chip({
  icon,
  tone,
  label,
  title,
}: {
  icon: React.ReactNode;
  tone: "bad" | "warn" | "ok" | "neutral" | "accent";
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

function ComplexityMarker({
  fn,
  onExplain,
  open,
}: {
  fn: FnMarker;
  /** When set, the marker is a button that opens the AI insight for this fn. */
  onExplain?: () => void;
  open?: boolean;
}) {
  const tone = complexityTone(fn.complexity);
  const color = tone === "high" ? TOK.rose : TOK.amber;

  // Non-interactive (e.g. the read-only public preview) — a plain badge.
  if (!onExplain) {
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

  // Interactive: the complexity number doubles as "explain this function". Filled
  // accent when its panel is open; a hover lift otherwise for discoverability.
  return (
    <button
      type="button"
      onClick={onExplain}
      title={`Explain ${fn.name || "this function"} with AI · complexity ${fn.complexity}`}
      className="text-[9px] font-semibold leading-none rounded px-1 py-0.5 transition cursor-pointer hover:brightness-125"
      style={{
        color: open ? "#0a0a0c" : color,
        background: open ? color : "rgba(255,255,255,0.05)",
        boxShadow: open ? "none" : `inset 0 0 0 1px rgba(255,255,255,0.06)`,
        fontFamily: "var(--font-mono)",
      }}
    >
      {fn.complexity}
    </button>
  );
}
