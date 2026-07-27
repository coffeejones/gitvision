"use client";

// The per-function AI insight panel — the source-aware layer of the Source view.
// Opens inline under a function when its gutter marker is clicked. It POSTs to
// /api/sessions/[id]/source/explain, which reads the function's source + the
// deterministic signals and returns a grounded { does, risk, suggestion }.
//
// The panel LEADS with the computed evidence (the same signals the model was
// given) and only then shows the AI reading — the grounded frame made visible,
// so the narrative always sits on top of the facts, never floats free of them.
//
// Privacy: this is the one action that sends repository source to Anthropic. It
// discloses that in the footer, and for a private repo it asks for a one-time
// consent before the first call (the source is the user's own, not public).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  X,
  Loader2,
  TriangleAlert,
  ShieldAlert,
  Info,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { AiReadingBody, AiReadingDivider, EvidenceRow } from "@/components/views/AiReading";
import { type FnMarker, type FileChips } from "@/lib/sourceAnnotations";
import { buildFunctionSignals, type FunctionSignals } from "@/lib/functionSignals";
import type { FunctionExplanation } from "@/lib/functionExplain";
import {
  grantPrivateExplainConsent,
  needsPrivateExplainConsent,
} from "@/lib/explainConsent";


export interface InsightResult {
  signals: FunctionSignals;
  explanation: FunctionExplanation;
  cached: boolean;
}

type Phase =
  | { status: "consent" } // private repo, first use — awaiting opt-in
  | { status: "loading" }
  | { status: "error"; message: string; drifted?: boolean; signIn?: boolean }
  | { status: "loaded"; result: InsightResult };

export function FunctionInsight({
  sessionId,
  path,
  marker,
  chips,
  repoPrivate,
  initial,
  onLoaded,
  onClose,
}: {
  sessionId: string;
  path: string;
  marker: FnMarker;
  /** The file's deterministic chips — lets us build the evidence row on the
   *  client so the facts show before the AI responds. Matches what the server
   *  hands the model, so nothing shifts when the reading lands. */
  chips?: FileChips | null;
  repoPrivate: boolean;
  /** A result already fetched this session — render it instantly, no re-fetch. */
  initial?: InsightResult;
  /** Lift a freshly-fetched result up so re-opening this function is instant. */
  onLoaded?: (result: InsightResult) => void;
  onClose: () => void;
}) {
  const line = marker.startRow + 1;
  const fnName = marker.name || "(anonymous)";
  // The deterministic evidence, built on the client from the same marker + file
  // chips the server uses — identical by construction to result.signals, but on
  // screen the instant the panel opens instead of after the AI round-trip.
  const localSignals = buildFunctionSignals(path, marker, chips);

  const [phase, setPhase] = useState<Phase>(() => {
    if (initial) return { status: "loaded", result: initial };
    if (needsPrivateExplainConsent(repoPrivate)) return { status: "consent" };
    return { status: "loading" };
  });

  // Guard against setting state after unmount / a superseded fetch.
  const reqId = useRef(0);

  async function run() {
    const my = ++reqId.current;
    setPhase({ status: "loading" });
    try {
      const res = await fetch(`/api/sessions/${sessionId}/source/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, fn: marker.name, line }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        signals?: FunctionSignals;
        explanation?: FunctionExplanation;
        cached?: boolean;
        error?: string;
        drifted?: boolean;
        signIn?: boolean;
      };
      if (my !== reqId.current) return;
      if (!res.ok || !body.explanation || !body.signals) {
        setPhase({
          status: "error",
          message: body.error || `Couldn't explain this function (HTTP ${res.status}).`,
          drifted: body.drifted,
          signIn: body.signIn,
        });
        return;
      }
      const result: InsightResult = {
        signals: body.signals,
        explanation: body.explanation,
        cached: body.cached ?? false,
      };
      setPhase({ status: "loaded", result });
      onLoaded?.(result);
    } catch (err) {
      if (my !== reqId.current) return;
      setPhase({
        status: "error",
        message: err instanceof Error ? err.message : "Couldn't reach the explainer.",
      });
    }
  }

  // Kick off automatically unless we're waiting on private-repo consent or
  // already have a result.
  useEffect(() => {
    if (phase.status === "loading") void run();
    return () => {
      reqId.current++;
    };
    // Run once on mount; subsequent retries go through the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function grantConsentAndRun() {
    grantPrivateExplainConsent();
    void run();
  }

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        borderTop: `1px solid ${TOK.border}`,
        borderBottom: `1px solid ${TOK.border}`,
        background: TOK.surfaceElevated,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-9" style={{ borderBottom: `1px solid ${TOK.border}` }}>
        <Sparkles size={13} style={{ color: TOK.accent }} className="flex-shrink-0" />
        <span className="text-[12px] font-medium" style={{ color: TOK.textPrimary, fontFamily: "var(--font-mono)" }}>
          {fnName}
        </span>
        <span className="text-[11px]" style={{ color: TOK.textMuted }}>
          L{line} · AI reading
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded transition hover:bg-white/5"
          style={{ color: TOK.textMuted }}
        >
          <X size={13} />
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {phase.status === "consent" ? (
          <ConsentGate repoPrivate={repoPrivate} onConfirm={grantConsentAndRun} onCancel={onClose} />
        ) : (
          <>
            {/* Evidence leads — the deterministic facts, computed on the client,
                on screen the instant the panel opens. Past consent it shows in
                every phase (loading / error / loaded), so the grounded frame is
                never gated behind the 2-3s AI round-trip. The reading below sits
                on top of these, never floats free of them. */}
            <EvidenceRow signals={localSignals} />
            <AiReadingDivider />
          </>
        )}

        {phase.status === "loading" && (
          <div className="flex items-center gap-2 text-[12.5px] py-1" style={{ color: TOK.textSecondary }}>
            <Loader2 size={14} className="animate-spin" style={{ color: TOK.accent }} />
            Reading the function…
          </div>
        )}

        {phase.status === "error" && (
          <div className="flex flex-col gap-2">
            <div
              className="flex items-start gap-2 text-[12.5px]"
              style={{ color: phase.signIn ? TOK.textSecondary : TOK.amber }}
            >
              {phase.signIn ? (
                <Sparkles size={14} className="flex-shrink-0 mt-0.5" style={{ color: TOK.accent }} />
              ) : (
                <TriangleAlert size={14} className="flex-shrink-0 mt-0.5" />
              )}
              <span>{phase.message}</span>
            </div>
            {phase.signIn ? (
              <Link
                href={`/login?next=${encodeURIComponent(`/session/${sessionId}/source?file=${path}`)}`}
                className="self-start inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md transition hover:opacity-90"
                style={{ background: TOK.accent, color: "#0a0a0c" }}
              >
                <Sparkles size={12} /> Sign in — it&rsquo;s free
              </Link>
            ) : phase.drifted ? null : (
              <button
                type="button"
                onClick={() => void run()}
                className="self-start text-[11px] px-2 py-1 rounded transition hover:bg-white/5"
                style={{ color: TOK.accent, border: `1px solid ${TOK.border}` }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {phase.status === "loaded" && <InsightBody result={phase.result} />}
      </div>

      {/* Footer — the honest disclosure, always present once past consent. */}
      {phase.status !== "consent" && (
        <div
          className="flex items-center gap-1.5 px-4 py-2 text-[10.5px]"
          style={{ borderTop: `1px solid ${TOK.border}`, color: TOK.textMuted }}
        >
          <Info size={11} className="flex-shrink-0" />
          <span>
            Reads this function&rsquo;s source with AI — sent to Anthropic on your click, never stored.
          </span>
          {phase.status === "loaded" && (
            <span className="ml-auto flex items-center gap-2 flex-shrink-0">
              {phase.result.cached && <span>cached</span>}
              <span style={{ fontFamily: "var(--font-mono)" }}>{modelLabel(phase.result.explanation.model)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Consent gate (private repos, first use) ────────────────────────────────

function ConsentGate({
  repoPrivate,
  onConfirm,
  onCancel,
}: {
  repoPrivate: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: TOK.textSecondary }}>
        <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" style={{ color: TOK.amber }} />
        <span>
          This sends {repoPrivate ? "this function’s source from your private repo" : "this function’s source"} to
          Anthropic to read it, one function at a time. It is never stored — only the explanation is kept, in memory.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition hover:opacity-90"
          style={{ background: TOK.accent, color: "#0a0a0c" }}
        >
          <Sparkles size={12} /> Read with AI
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] px-3 py-1.5 rounded-md transition hover:bg-white/5"
          style={{ color: TOK.textMuted, border: `1px solid ${TOK.border}` }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// ─── Loaded body: the AI reading (the evidence row leads the panel above) ───

function InsightBody({ result }: { result: InsightResult }) {
  // The evidence row leads the whole panel (hoisted above the phase switch), so
  // the AI body is just the three grounded parts — shared with the Flows
  // surface so the two can't drift (components/views/AiReading.tsx).
  return <AiReadingBody explanation={result.explanation} />;
}





// ─── helpers ────────────────────────────────────────────────────────────────

/** "claude-haiku-4-5" → "Haiku 4.5". Best-effort; falls back to the raw id. */
function modelLabel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (!m) return model;
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${name} ${m[2]}.${m[3]}`;
}
