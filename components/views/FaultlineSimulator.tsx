"use client";

// The Faultline Simulator (F-1) — the human "what if I change this?" surface.
//
// Pick a file → we POST it to /api/sessions/[id]/simulate as a DELETE (the most
// dramatic, zero-typing "what breaks?" question) → the Shadow-Graph patcher
// rebuilds the graph from the cached parse layer and returns a deterministic
// blast verdict + the required-actions "conscience". No AI, no guesswork — every
// number is cited to imports + call edges.
//
// The request is synchronous (sub-second — only the touched file re-parses), so
// this is a single fetch → local state, no job poll. F-2 adds a live dependency
// canvas beside this that lights up the blast reach.

import { useCallback, useMemo, useState } from "react";
import { Zap, Search, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { SimulateResult, RequiredAction } from "@/lib/shadowGraph/simulate";
import type { ChangeBlastReport } from "@/lib/changeBlast/types";
import { FaultlineBlastCanvas } from "@/components/views/FaultlineBlastCanvas";

// Verdict traffic light under the CH palette: heat is rationed to criticals, so
// a cleared verdict goes quiet/neutral, not green.
const VERDICT_TOK: Record<
  ChangeBlastReport["verdict"],
  { label: string; color: string; soft: string }
> = {
  "high-risk": { label: "High risk", color: TOK.rose, soft: TOK.roseSoft },
  review: { label: "Review carefully", color: TOK.amber, soft: TOK.amberSoft },
  clear: { label: "Clear", color: TOK.accent, soft: TOK.accentSoft },
};

const SEVERITY_TOK: Record<RequiredAction["severity"], string> = {
  high: TOK.rose,
  medium: TOK.amber,
  low: TOK.textMuted,
};

const ACTION_LABEL: Record<RequiredAction["kind"], string> = {
  "load-bearing-touched": "Load-bearing code touched",
  "update-guarding-tests": "Guarding tests left stale",
  "guarding-tests-will-break": "Guarding tests will break too",
  "no-guarding-tests": "No guarding test",
  "hollow-tests-added": "Hollow tests added",
  "new-duplicate": "New duplicate code",
};

const FILE_ROW_CAP = 80;
const PICKER_CAP = 60;

type Phase = "idle" | "running" | "done" | "error";

/** Discriminated result the fetch resolves to. */
type Outcome =
  | { kind: "verdict"; result: SimulateResult }
  | { kind: "fallback"; message: string }
  | { kind: "error"; message: string };

interface Props {
  sessionId: string;
  /** Every analyzed file (the simulatable set — keys of codeGraph.contentHashes). */
  files: string[];
  /** A short list of high-impact files to seed the picker with the good demo. */
  suggested: string[];
}

export function FaultlineSimulator({ sessionId, files, suggested }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
    return base.slice(0, PICKER_CAP);
  }, [files, query]);

  const runSimulate = useCallback(
    async (path: string) => {
      setSelected(path);
      setPhase("running");
      setOutcome(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/simulate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // A delete is `newContent: null` — "what breaks if this file is gone?"
          body: JSON.stringify({ changes: [{ path, newContent: null }] }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setOutcome({
            kind: "error",
            message:
              (body && (body.message || body.error)) ||
              `Simulation failed (${res.status}). Try again in a moment.`,
          });
          setPhase("error");
          return;
        }
        if (!body || body.ok === false) {
          setOutcome({
            kind: "fallback",
            message:
              (body && body.message) ||
              "This session can't be simulated yet — refresh it to rebuild the parse layer.",
          });
          setPhase("done");
          return;
        }
        setOutcome({ kind: "verdict", result: body.result as SimulateResult });
        setPhase("done");
      } catch {
        setOutcome({
          kind: "error",
          message: "Couldn't reach the simulator. Check your connection and retry.",
        });
        setPhase("error");
      }
    },
    [sessionId],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
      {/* ── Picker rail ─────────────────────────────────────────── */}
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <div className="p-4 flex flex-col gap-3" style={{ borderBottom: `1px solid ${TOK.border}` }}>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: TOK.textMuted }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files to simulate…"
              aria-label="Search files to simulate deleting"
              className="w-full rounded-lg pl-9 pr-3 py-2 text-sm outline-none"
              style={{
                background: TOK.bg,
                border: `1px solid ${TOK.border}`,
                color: TOK.textPrimary,
              }}
            />
          </div>
          {suggested.length > 0 && !query && (
            <div className="flex flex-col gap-2">
              <span
                className="text-[10px] uppercase tracking-[0.16em]"
                style={{ color: TOK.textMuted }}
              >
                High-impact targets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggested.map((f) => (
                  <button
                    key={f}
                    onClick={() => runSimulate(f)}
                    title={f}
                    className="text-[11px] rounded-md px-2 py-1 max-w-full truncate transition-colors"
                    style={{
                      background: TOK.roseSoft,
                      border: `1px solid ${TOK.border}`,
                      color: TOK.textSecondary,
                      fontFamily: "var(--font-ct-mono, monospace)",
                    }}
                  >
                    {baseName(f)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          {filtered.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: TOK.textMuted }}>
              No files match “{query.trim()}”.
            </p>
          ) : (
            filtered.map((f, i) => {
              const isSel = f === selected;
              return (
                <button
                  key={f}
                  onClick={() => runSimulate(f)}
                  title={f}
                  className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors"
                  style={{
                    background: isSel ? TOK.roseSoft : "transparent",
                    borderTop: i === 0 ? "none" : `1px solid ${TOK.border}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) e.currentTarget.style.background = TOK.surfaceElevated;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    className="text-[13px] truncate"
                    style={{
                      color: TOK.textPrimary,
                      fontFamily: "var(--font-ct-mono, monospace)",
                    }}
                  >
                    {baseName(f)}
                  </span>
                  {dirName(f) && (
                    <span className="text-[11px] truncate" style={{ color: TOK.textMuted }}>
                      {dirName(f)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Result panel ────────────────────────────────────────── */}
      <div className="min-w-0">
        {phase === "idle" && <IdlePrompt />}
        {phase === "running" && <RunningState path={selected} />}
        {(phase === "done" || phase === "error") && outcome && (
          <ResultPanel path={selected} outcome={outcome} onRetry={() => selected && runSimulate(selected)} />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────

function IdlePrompt() {
  return (
    <div
      className="rounded-xl h-full min-h-[280px] flex flex-col items-center justify-center text-center gap-3 px-8 py-12"
      style={{ background: TOK.surface, border: `1px dashed ${TOK.border}` }}
    >
      <div
        className="rounded-full p-3"
        style={{ background: TOK.roseSoft, color: TOK.rose }}
      >
        <Zap size={22} />
      </div>
      <p className="text-base font-semibold" style={{ color: TOK.textPrimary }}>
        Pick a file to feel the shockwave
      </p>
      <p className="text-sm max-w-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
        We simulate deleting it and rebuild the graph — showing exactly what
        breaks, how far it reaches, and which paths have no test to catch it.
        Deterministic, cited to real imports and calls.
      </p>
    </div>
  );
}

function RunningState({ path }: { path: string | null }) {
  return (
    <div
      className="rounded-xl h-full min-h-[280px] flex flex-col items-center justify-center text-center gap-3 px-8 py-12"
      style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      <Loader2 size={22} className="animate-spin" style={{ color: TOK.textMuted }} />
      <p className="text-sm" style={{ color: TOK.textSecondary }}>
        Simulating the blast of deleting{" "}
        <span style={{ fontFamily: "var(--font-ct-mono, monospace)", color: TOK.textPrimary }}>
          {path ? baseName(path) : "…"}
        </span>
      </p>
    </div>
  );
}

function ResultPanel({
  path,
  outcome,
  onRetry,
}: {
  path: string | null;
  outcome: Outcome;
  onRetry: () => void;
}) {
  if (outcome.kind === "error" || outcome.kind === "fallback") {
    const isError = outcome.kind === "error";
    return (
      <div
        className="rounded-xl min-h-[280px] flex flex-col items-center justify-center text-center gap-3 px-8 py-12"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <div style={{ color: isError ? TOK.rose : TOK.textMuted }}>
          {isError ? <AlertTriangle size={22} /> : <RefreshCw size={22} />}
        </div>
        <p className="text-sm max-w-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
          {outcome.message}
        </p>
        {isError && (
          <button
            onClick={onRetry}
            className="text-sm rounded-lg px-3 py-1.5 transition-colors"
            style={{ background: TOK.accentSoft, border: `1px solid ${TOK.border}`, color: TOK.textPrimary }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const result = outcome.result;
  // A delete always takes the golden fast path; a non-patched mode here means the
  // engine declined (shouldn't happen for a single delete) — surface it plainly.
  if (result.mode !== "patched" || !result.report) {
    return (
      <div
        className="rounded-xl min-h-[280px] flex items-center justify-center text-center px-8 py-12"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <p className="text-sm max-w-sm" style={{ color: TOK.textSecondary }}>
          This change couldn&rsquo;t be simulated on the fast path
          {result.reason ? ` — ${result.reason}` : "."} Re-analyze the repo for an
          exact result.
        </p>
      </div>
    );
  }

  return <Verdict path={path} result={result} />;
}

function Verdict({ path, result }: { path: string | null; result: SimulateResult }) {
  const report = result.report!;
  const actions = result.requiredActions;
  const affected = result.affectedFiles;
  const v = VERDICT_TOK[report.verdict];
  const shown = affected.slice(0, FILE_ROW_CAP);
  const hidden = affected.length - shown.length;
  const untested = affected.filter((a) => a.untested).length;
  const epicenter = path ?? "the file";
  const base = baseName(epicenter);
  const noTest = untested > 0 ? `, ${untested} with no test to catch it` : "";
  // Delete-framed, composed from ONE number (affected.length) so nothing on the
  // card contradicts — not the modify-framed report.headline.
  const headline =
    affected.length === 0
      ? `Deleting ${base} breaks nothing — no file depends on it.`
      : report.loadBearingTouched.length > 0
        ? `${base} is load-bearing — deleting it breaks ${affected.length} file${affected.length === 1 ? "" : "s"}${noTest}.`
        : `Deleting ${base} breaks ${affected.length} file${affected.length === 1 ? "" : "s"}${noTest}.`;

  return (
    <div className="flex flex-col gap-4">
      {/* Brief card */}
      <div
        className="rounded-xl p-5 flex flex-col gap-3"
        style={{ background: TOK.surface, border: `1px solid ${v.color}55` }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="text-[13px] font-bold rounded-lg px-3 py-1"
            style={{ color: v.color, background: v.soft, border: `1px solid ${v.color}55` }}
          >
            {v.label}
          </span>
          <span className="text-[13px]" style={{ color: TOK.textMuted }}>
            if you delete{" "}
            <span style={{ fontFamily: "var(--font-ct-mono, monospace)", color: TOK.textSecondary }}>
              {baseName(epicenter)}
            </span>
          </span>
        </div>
        <p className="text-base font-semibold" style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}>
          {headline}
        </p>
        <div className="flex gap-5 flex-wrap text-[13px]" style={{ color: TOK.textMuted }}>
          <Stat
            n={affected.length}
            one="file breaks"
            many="files break"
            accent={affected.length > 0 ? v.color : undefined}
          />
          <Stat n={untested} one="with no test" many="with no test" accent={untested > 0 ? TOK.rose : undefined} />
          <Stat
            n={report.loadBearingTouched.length}
            one="load-bearing wall"
            many="load-bearing walls"
            accent={report.loadBearingTouched.length > 0 ? TOK.rose : undefined}
          />
          <Stat n={report.testsToRun.length} one="guarding test" many="guarding tests" />
        </div>
      </div>

      {/* The shockwave — the hero */}
      <FaultlineBlastCanvas epicenter={epicenter} affected={affected} />

      {/* Required actions — the conscience */}
      {actions.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
        >
          <div className="px-4 py-2.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: TOK.textMuted, borderBottom: `1px solid ${TOK.border}` }}>
            Before you touch this
          </div>
          {actions.map((a, i) => (
            <div
              key={a.kind}
              className="px-4 py-3 flex items-start gap-3"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${TOK.border}` }}
            >
              <span
                className="mt-1.5 rounded-full flex-shrink-0"
                style={{ width: 7, height: 7, background: SEVERITY_TOK[a.severity] }}
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[13px] font-medium" style={{ color: TOK.textPrimary }}>
                  {ACTION_LABEL[a.kind]}
                </span>
                <span className="text-[12.5px] leading-relaxed" style={{ color: TOK.textSecondary }}>
                  {a.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Affected files — the concrete casualty list */}
      {affected.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${TOK.border}` }}>
          {shown.map((f, i) => (
            <div
              key={f.path}
              className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 items-center"
              style={{
                background: i % 2 === 0 ? TOK.surface : "transparent",
                borderTop: i === 0 ? "none" : `1px solid ${TOK.border}`,
              }}
            >
              <span
                className="text-[13px] break-all min-w-0"
                style={{ color: TOK.textPrimary, fontFamily: "var(--font-ct-mono, monospace)" }}
              >
                {f.path}
              </span>
              <span
                className="text-[11.5px] text-right whitespace-nowrap"
                style={{ color: f.untested ? TOK.rose : TOK.textMuted }}
              >
                {f.untested ? "no test" : f.isTest ? "guarding test" : "covered"}
                {f.hop > 1 && ` · ${f.hop} hops`}
              </span>
            </div>
          ))}
          {hidden > 0 && (
            <div className="px-4 py-2.5 text-[12px]" style={{ color: TOK.textMuted, borderTop: `1px solid ${TOK.border}` }}>
              + {hidden} more file{hidden === 1 ? "" : "s"} reached
            </div>
          )}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed" style={{ color: TOK.textMuted }}>
        Deterministic — the deletion mapped onto the cached code graph, cited to
        imports + call edges. It shows what the change <em>reaches</em>, not whether
        the code is correct.
      </p>
    </div>
  );
}

function Stat({
  n,
  one,
  many,
  accent,
}: {
  n: number;
  one: string;
  many: string;
  accent?: string;
}) {
  return (
    <span style={{ color: accent ?? TOK.textMuted }}>
      <strong style={{ color: accent ?? TOK.textSecondary, fontWeight: 700 }}>{n}</strong>{" "}
      {n === 1 ? one : many}
    </span>
  );
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}
function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i + 1);
}
