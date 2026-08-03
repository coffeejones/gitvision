"use client";

// The Flows surface — pick an entry point, see what it reaches.
//
// Traces are precomputed server-side (they are pure and small), so switching
// between entry points is instant and the client never receives the full call
// graph.
//
// The honesty rules this component exists to keep:
//   - "reaches", never "then". The x axis is hops, not time.
//   - The call-resolution rate is printed on screen, not hidden, because the
//     tree can only be drawn from calls that resolved.
//   - Truncation is stated when a cap bit.

import { useCallback, useState } from "react";
import Link from "next/link";
import { Route, CornerDownRight, FileCode2, Sparkles } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { FlowCanvas } from "@/components/views/FlowCanvas";
import { AiReadingBody, AiReadingDivider, EvidenceRow } from "@/components/views/AiReading";
import {
  grantPrivateExplainConsent,
  needsPrivateExplainConsent,
} from "@/lib/explainConsent";
import type { FunctionSignals } from "@/lib/functionSignals";
import { formatCount } from "@/lib/formatLocale";
import type {
  FlowEntryPoint,
  FlowResolution,
  FlowTrace,
  FlowTraceNode,
} from "@/lib/codeAnalysis/flowTrace";

export interface FlowEntry {
  entry: FlowEntryPoint;
  trace: FlowTrace;
}

const KIND_LABEL: Record<FlowEntryPoint["kind"], string> = {
  "route-like": "entry point",
  root: "nothing calls it",
  orchestrator: "coordinator",
};

const basename = (p: string) => p.split("/").pop() ?? p;

/** One node's AI reading. `does` is the plain-English "what this does" that ends
 *  up on the card; `risk` and `suggestion` fill the detail bar. */
interface Caption {
  loading?: boolean;
  does?: string;
  risk?: string;
  suggestion?: string | null;
  /** The deterministic signals the same response carries. Shown as chips ABOVE
   *  the prose so a reader can always tell computed fact from AI reading. */
  signals?: FunctionSignals;
  error?: string;
  /** The free-phase gate answered "sign in" rather than failing — that's a
   *  prompt, not an error, and gets a CTA instead of red text (same treatment
   *  the Source view's FunctionInsight gives it). */
  signIn?: boolean;
}

export function FlowsView({
  sessionId,
  flows,
  resolution,
  repoPrivate,
}: {
  sessionId: string;
  flows: FlowEntry[];
  resolution: FlowResolution;
  /** Whether the analyzed repo was private. Drives the same one-time opt-in
   *  the Source view asks for before the explainer sends source to Anthropic.
   *  This surface used to send without asking at all. */
  repoPrivate: boolean;
}) {
  const [activeId, setActiveId] = useState(flows[0]?.entry.id ?? "");
  const [selected, setSelected] = useState<FlowTraceNode | null>(null);
  const [captions, setCaptions] = useState<Map<string, Caption>>(new Map());
  /** Node whose reading is waiting on the private-repo opt-in. */
  const [pendingConsent, setPendingConsent] = useState<FlowTraceNode | null>(null);

  const setCaption = useCallback((id: string, patch: Caption) => {
    setCaptions((prev) => new Map(prev).set(id, patch));
  }, []);

  /** Fetch one node's reading. Reuses the Source view's endpoint, so the whole
   *  gate stack (read access, entitlement, AI budget, per-IP rate limit, cache,
   *  source pinned to the analyzed commit) applies unchanged — and the
   *  explanation stays grounded in that function's computed signals. Lazy on
   *  purpose: 14 nodes explained up front would spend the daily budget on
   *  functions nobody asked about. */
  const explain = useCallback(
    async (node: FlowTraceNode) => {
      if (!node.line) return; // no known definition line → nothing to ground on
      // Private repo, first use in this browser: ask before any source leaves.
      // Clicking a node here is a much lighter gesture than opening the Source
      // view's panel, which is exactly why this surface needed the gate most.
      if (needsPrivateExplainConsent(repoPrivate)) {
        setPendingConsent(node);
        return;
      }
      setCaption(node.id, { loading: true });
      try {
        const res = await fetch(`/api/sessions/${sessionId}/source/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: node.filePath, fn: node.name, line: node.line }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          explanation?: { does?: string; risk?: string; suggestion?: string | null };
          signals?: FunctionSignals;
          error?: string;
          signIn?: boolean;
        };
        if (!res.ok || !body.explanation?.does) {
          setCaption(node.id, {
            error: body.error ?? "Couldn't read this one.",
            signIn: body.signIn,
          });
          return;
        }
        setCaption(node.id, {
          does: body.explanation.does,
          risk: body.explanation.risk,
          suggestion: body.explanation.suggestion ?? null,
          signals: body.signals,
        });
      } catch {
        setCaption(node.id, { error: "Network error — try again." });
      }
    },
    [sessionId, setCaption]
  );

  const onSelectNode = useCallback(
    (node: FlowTraceNode) => {
      setSelected(node);
      // Read it once; a second click just re-selects.
      if (!captions.has(node.id)) void explain(node);
    },
    [captions, explain]
  );

  const active = flows.find((f) => f.entry.id === activeId) ?? flows[0];
  if (!active) return null;
  const selectedCaption = selected ? captions.get(selected.id) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* ---- entry-point picker ---- */}
        <aside
          className="lg:w-72 shrink-0 rounded-lg overflow-hidden"
          style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
          <div
            className="px-3 py-2 text-[11px] uppercase tracking-wide"
            style={{ color: TOK.textMuted, borderBottom: `1px solid ${TOK.border}` }}
          >
            Where things start
          </div>
          <ul className="max-h-[520px] overflow-y-auto">
            {flows.map(({ entry, trace }) => {
              const on = entry.id === active.entry.id;
              return (
                <li key={entry.id}>
                  <button
                    onClick={() => {
                      setActiveId(entry.id);
                      setSelected(null);
                    }}
                    className="w-full text-left px-3 py-2 flex flex-col gap-0.5"
                    style={{
                      background: on ? TOK.accentSoft : "transparent",
                      borderLeft: `2px solid ${on ? TOK.accent : "transparent"}`,
                      borderBottom: `1px solid ${TOK.border}`,
                    }}
                  >
                    <span
                      className="text-[13px] font-medium truncate"
                      style={{ color: TOK.textPrimary, fontFamily: "var(--font-ct-mono, monospace)" }}
                    >
                      {entry.name}
                    </span>
                    <span className="text-[11px] truncate" style={{ color: TOK.textMuted }}>
                      {entry.filePath}
                    </span>
                    <span className="text-[10px]" style={{ color: TOK.textMuted }}>
                      reaches {trace.reachedTotal} · {KIND_LABEL[entry.kind]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ---- canvas ---- */}
        <div
          className="flex-1 rounded-lg overflow-hidden min-w-0"
          style={{ border: `1px solid ${TOK.border}` }}
        >
          <div
            className="px-3 py-2 flex items-center gap-2 flex-wrap"
            style={{ borderBottom: `1px solid ${TOK.border}`, background: TOK.surface }}
          >
            <Route size={13} style={{ color: TOK.accent }} />
            <span
              className="text-[13px] font-medium"
              style={{ color: TOK.textPrimary, fontFamily: "var(--font-ct-mono, monospace)" }}
            >
              {active.entry.name}
            </span>
            <span className="text-[11px]" style={{ color: TOK.textMuted }}>
              reaches {active.trace.reachedTotal} function
              {active.trace.reachedTotal === 1 ? "" : "s"}
              {active.trace.truncated
                ? ` · showing the closest ${active.trace.nodes.length - 1}`
                : `, up to ${active.trace.maxDepth} hop${active.trace.maxDepth === 1 ? "" : "s"} away`}
            </span>
          </div>
          <FlowCanvas
            trace={active.trace}
            selectedId={selected?.id}
            onSelect={onSelectNode}
            captions={captions}
          />
        </div>
      </div>

      {/* ---- selected node detail ---- */}
      {selected && (
        <div
          className="rounded-lg px-4 py-3 flex flex-col gap-2"
          style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CornerDownRight size={14} style={{ color: TOK.accent }} />
            <span
              className="text-[13px] font-medium"
              style={{ color: TOK.textPrimary, fontFamily: "var(--font-ct-mono, monospace)" }}
            >
              {selected.name}
            </span>
            <span className="text-[11px]" style={{ color: TOK.textMuted }}>
              {selected.depth === 0
                ? "the entry point"
                : `${selected.depth} hop${selected.depth === 1 ? "" : "s"} from ${active.entry.name}`}
              {selected.complexity > 1 ? ` · complexity ${selected.complexity}` : ""}
              {selected.elidedChildren > 0
                ? ` · calls ${selected.elidedChildren} more not drawn here`
                : ""}
            </span>
            <Link
              href={`/session/${sessionId}/source?file=${encodeURIComponent(selected.filePath)}&line=${selected.line}`}
              className="text-[11px] inline-flex items-center gap-1 ml-auto hover:underline"
              style={{ color: TOK.accent }}
            >
              <FileCode2 size={12} />
              Open {basename(selected.filePath)}
            </Link>
          </div>

          {/* The AI reading — grounded in this function's computed signals by the
              same endpoint the Source view uses. */}
          {selectedCaption?.loading && (
            <p className="text-[12px] italic" style={{ color: TOK.textMuted }}>
              Reading {selected.name}…
            </p>
          )}
          {selectedCaption?.error && (
            <p className="text-[12px]" style={{ color: TOK.textMuted }}>
              {selectedCaption.error}{" "}
              {selectedCaption.signIn ? (
                <Link
                  href={`/login?next=${encodeURIComponent(`/session/${sessionId}/flows`)}`}
                  className="inline-flex items-center gap-1 underline"
                  style={{ color: TOK.accent }}
                >
                  <Sparkles size={11} /> Sign in — it&rsquo;s free
                </Link>
              ) : (
                <button
                  onClick={() => void explain(selected)}
                  className="underline"
                  style={{ color: TOK.accent }}
                >
                  Try again
                </button>
              )}
            </p>
          )}
          {selectedCaption?.does && (
            <div className="flex flex-col gap-2.5">
              {/* Computed fact first, then the seam, then the model's reading —
                  so a reader can always tell which half a claim came from. */}
              {selectedCaption.signals && <EvidenceRow signals={selectedCaption.signals} />}
              <AiReadingDivider />
              <AiReadingBody
                explanation={{
                  does: selectedCaption.does,
                  risk: selectedCaption.risk ?? "",
                  suggestion: selectedCaption.suggestion,
                }}
              />
            </div>
          )}
          {pendingConsent?.id === selected.id && (
            <div
              className="flex flex-col gap-2 rounded-md px-3 py-2.5"
              style={{ border: `1px solid ${TOK.border}`, background: TOK.surfaceElevated }}
            >
              <p className="text-[12.5px] leading-relaxed" style={{ color: TOK.textSecondary }}>
                This repo is private. Reading a function sends{" "}
                <strong style={{ color: TOK.textPrimary }}>that function&rsquo;s source</strong> to
                Anthropic for that one request — nothing else, and it is never stored. Continue?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[12px] font-medium rounded px-2.5 py-1"
                  style={{ background: TOK.accent, color: "#0c0b0b" }}
                  onClick={() => {
                    grantPrivateExplainConsent();
                    const node = pendingConsent;
                    setPendingConsent(null);
                    void explain(node);
                  }}
                >
                  Read this function
                </button>
                <button
                  type="button"
                  className="text-[12px] rounded px-2.5 py-1"
                  style={{ border: `1px solid ${TOK.border}`, color: TOK.textSecondary }}
                  onClick={() => setPendingConsent(null)}
                >
                  Not now
                </button>
              </div>
            </div>
          )}
          {!selected.line && (
            <p className="text-[12px]" style={{ color: TOK.textMuted }}>
              We don&rsquo;t have a definition line for this one, so there&rsquo;s nothing to read
              from — it was reached by a call that resolved to a file we didn&rsquo;t index a
              function for.
            </p>
          )}
        </div>
      )}

      {/* ---- honesty footer ---- */}
      {!selected && (
        <p className="text-[11px]" style={{ color: TOK.textMuted }}>
          <Sparkles size={11} className="inline mr-1" style={{ color: TOK.accent }} />
          Click any box to have it read in plain English — the reading stays on the card, so the
          diagram fills in as you explore.
        </p>
      )}
      <p className="text-[11px] leading-relaxed" style={{ color: TOK.textMuted }}>
        Reading a box sends that one function&rsquo;s source to Anthropic, on your click and one
        function at a time. It is never stored — only the explanation is kept, in memory.
      </p>
      <p className="text-[11px] leading-relaxed" style={{ color: TOK.textMuted }}>
        Each arrow means <strong style={{ color: TOK.textSecondary }}>calls</strong> — not
        &ldquo;and then&rdquo;. Columns are how many calls away something is, not the order things
        happen: the analysis reads structure, not execution, so branches and early returns
        aren&rsquo;t visible here.{" "}
        {resolution.ownTotal > 0 && (
          <>
            Of the {formatCount(resolution.ownTotal)} calls we can tell point at this
            repo&rsquo;s own functions, {resolution.ownPct}% were traced to their definition. Calls
            into libraries and the language itself aren&rsquo;t drawn — there&rsquo;s nothing in
            this repo to point them at — and where several functions share a name, or a method is
            called on something we couldn&rsquo;t identify, we leave the arrow out rather than
            guess.
          </>
        )}
      </p>
    </div>
  );
}
