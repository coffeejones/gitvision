"use client";

// The what-if editor — where the read-only Source view becomes "The Conscience
// for humans". Edit a file in a scratch buffer (never stored), hit Simulate, and
// the same engine the agents use returns the deterministic blast + the conscience
// gate on your ACTUAL change: what breaks, and whether you're clear to proceed.
//
// The simulate engine already accepts `newContent` (the Faultline surface only
// sends `null` to model a delete) — so this is pure UI over a finished engine.
// A plain textarea for v1: the value is the verdict, not the editing UX; a
// highlighted editor is a later upgrade.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Loader2,
  RotateCcw,
  TriangleAlert,
  ShieldCheck,
  ShieldAlert,
  Pencil,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { SimulateResult } from "@/lib/shadowGraph/simulate";
import { FaultlineBlastCanvas } from "./FaultlineBlastCanvas";

// Matches the patch DoS gate (runPatch.ts): a single touched file is capped at
// 256 KB. Guard here so an over-cap buffer shows a hint instead of a 413.
const MAX_FILE_BYTES = 256 * 1024;

type Phase = "edit" | "running" | "result" | "error";

const byteLen = (s: string) => new TextEncoder().encode(s).length;

export function WhatIfEditor({
  sessionId,
  path,
  initialContent,
  onExit,
}: {
  sessionId: string;
  path: string;
  initialContent: string;
  /** Return to the read-only view. */
  onExit: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [phase, setPhase] = useState<Phase>("edit");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== initialContent;
  const bytes = useMemo(() => byteLen(content), [content]);
  const overCap = bytes > MAX_FILE_BYTES;

  // Abort an in-flight simulate if the user leaves edit mode / switches files
  // before it lands, so a late response can't setState on an unmounted editor.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function simulate() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("running");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes: [{ path, newContent: content }] }),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      if (ctrl.signal.aborted) return;
      if (!res.ok || !body || body.ok === false) {
        setError(
          (body && (body.message || body.error)) ||
            `Simulation failed (${res.status}). Try again in a moment.`,
        );
        setPhase("error");
        return;
      }
      // The engine can accept the request but decline the fast path (e.g. editing
      // package.json / tsconfig → "needs-full-analysis"). Those come back ok:true
      // with simulated:false and a not-evaluated gate — rendering that as a result
      // would show an alarming red "0 blocking". Route them to an honest message,
      // matching the Faultline surface.
      const result = body.result as SimulateResult;
      if (body.simulated === false || result.mode !== "patched") {
        setError(
          `This change couldn't be simulated on the fast path${result?.reason ? ` — ${result.reason}` : ""}. Re-analyze the repo for an exact result.`,
        );
        setPhase("error");
        return;
      }
      setResult(result);
      setPhase("result");
    } catch {
      if (ctrl.signal.aborted) return;
      setError("Couldn't reach the simulator. Check your connection and retry.");
      setPhase("error");
    }
  }

  return (
    <div className="flex flex-col min-w-0" style={{ height: "100%" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 h-10 flex-shrink-0"
        style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
      >
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition hover:bg-white/5 flex-shrink-0"
          style={{ color: TOK.textMuted }}
        >
          <ArrowLeft size={12} /> Read-only
        </button>
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: TOK.accent }}>
          <Pencil size={12} /> What if I change this?
        </span>
        <span
          className="text-[12.5px] font-medium truncate ml-1"
          style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}
        >
          {path}
        </span>
        <span className="ml-auto text-[11px] flex-shrink-0" style={{ color: overCap ? TOK.rose : TOK.textMuted }}>
          {(bytes / 1024).toFixed(1)} / 256 KB
        </span>
      </div>

      {/* Body */}
      {phase === "edit" || phase === "running" ? (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="px-4 py-1.5 text-[11px] flex-shrink-0" style={{ color: TOK.textMuted, borderBottom: `1px solid ${TOK.border}` }}>
            Edit freely — nothing is saved. Simulate to see what your change breaks.
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            disabled={phase === "running"}
            className="flex-1 min-h-0 w-full resize-none outline-none p-4"
            style={{
              background: TOK.surface,
              color: TOK.textPrimary,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: "20px",
              tabSize: 2,
            }}
          />
          <div
            className="flex items-center gap-3 px-4 h-12 flex-shrink-0"
            style={{ borderTop: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
          >
            <button
              type="button"
              onClick={simulate}
              disabled={!dirty || overCap || phase === "running"}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 h-8 rounded-lg transition disabled:opacity-40"
              style={{ background: TOK.accent, color: TOK.accentOn }}
            >
              {phase === "running" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {phase === "running" ? "Simulating…" : "Simulate change"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setContent(initialContent)}
                disabled={phase === "running"}
                className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded transition hover:bg-white/5"
                style={{ color: TOK.textMuted }}
              >
                <RotateCcw size={12} /> Reset
              </button>
            )}
            <span className="ml-auto text-[11px]" style={{ color: TOK.textMuted }}>
              {overCap ? "Too large to simulate" : dirty ? "unsaved scratch edit" : "no change yet"}
            </span>
          </div>
        </div>
      ) : phase === "error" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <TriangleAlert size={24} style={{ color: TOK.amber }} />
          <div className="text-[15px] font-medium" style={{ color: TOK.textPrimary }}>
            Couldn&apos;t simulate that change
          </div>
          <div className="text-[13px] max-w-md leading-relaxed" style={{ color: TOK.textSecondary }}>
            {error}
          </div>
          <button
            type="button"
            onClick={() => setPhase("edit")}
            className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg mt-1"
            style={{ border: `1px solid ${TOK.border}`, color: TOK.textSecondary }}
          >
            <ArrowLeft size={12} /> Back to the buffer
          </button>
        </div>
      ) : result ? (
        <ResultView path={path} result={result} onBack={() => setPhase("edit")} />
      ) : null}
    </div>
  );
}

// ─── Result: the conscience verdict on your edit ────────────────────────────

function ResultView({
  path,
  result,
  onBack,
}: {
  path: string;
  result: SimulateResult;
  onBack: () => void;
}) {
  const gate = result.gate;
  const affected = result.affectedFiles;
  const base = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {/* The gate — the headline: are you clear to proceed? */}
      <div
        className="rounded-xl p-5 flex flex-col gap-3"
        style={{
          background: TOK.surface,
          border: `1px solid ${gate.pass ? "#3fb95055" : `${TOK.rose}55`}`,
        }}
      >
        <div className="flex items-center gap-2.5">
          {gate.pass ? (
            <ShieldCheck size={18} style={{ color: "#3fb950" }} />
          ) : (
            <ShieldAlert size={18} style={{ color: TOK.rose }} />
          )}
          <span
            className="text-[13px] font-bold rounded-lg px-3 py-1"
            style={{
              color: gate.pass ? "#3fb950" : TOK.rose,
              background: gate.pass ? "#3fb95015" : `${TOK.rose}15`,
            }}
          >
            {gate.pass ? "Clear to proceed" : `${gate.blocking.length} blocking`}
          </span>
          <span className="text-[13px]" style={{ color: TOK.textMuted }}>
            for your change to{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: TOK.textSecondary }}>{base}</span>
          </span>
        </div>
        <p className="text-[14px] leading-relaxed" style={{ color: TOK.textPrimary }}>
          {gate.directive}
        </p>
      </div>

      {/* Required actions — resolve-or-justify before you finish */}
      {result.requiredActions.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}>
          <div
            className="px-4 py-2.5 text-[10px] uppercase tracking-[0.16em]"
            style={{ color: TOK.textMuted, borderBottom: `1px solid ${TOK.border}` }}
          >
            What your change touches
          </div>
          {result.requiredActions.map((a, i) => {
            const blocking = gate.blocking.some((b) => b.kind === a.kind);
            return (
              <div
                key={a.kind}
                className="px-4 py-3 flex items-start gap-3"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${TOK.border}` }}
              >
                <span
                  className="mt-1.5 rounded-full flex-shrink-0"
                  style={{ width: 7, height: 7, background: blocking ? TOK.rose : TOK.amber }}
                />
                <span className="text-[13px] leading-relaxed" style={{ color: TOK.textSecondary }}>
                  {a.detail}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* The blast — files your change reaches */}
      {affected.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: TOK.textMuted }}>
            Reaches {affected.length} file{affected.length === 1 ? "" : "s"}
          </span>
          <FaultlineBlastCanvas epicenter={path} affected={affected} verb="Change" />
        </div>
      )}

      {result.approximations.length > 0 && (
        <p className="text-[11px] leading-relaxed" style={{ color: TOK.textMuted }}>
          {result.approximations.join(" · ")}
        </p>
      )}

      <button
        type="button"
        onClick={onBack}
        className="self-start inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg"
        style={{ border: `1px solid ${TOK.border}`, color: TOK.textSecondary }}
      >
        <ArrowLeft size={12} /> Back to the buffer
      </button>
    </div>
  );
}
