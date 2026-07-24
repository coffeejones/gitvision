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

import { useState } from "react";
import Link from "next/link";
import { Route, CornerDownRight, FileCode2 } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { FlowCanvas } from "@/components/views/FlowCanvas";
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

export function FlowsView({
  sessionId,
  flows,
  resolution,
}: {
  sessionId: string;
  flows: FlowEntry[];
  resolution: FlowResolution;
}) {
  const [activeId, setActiveId] = useState(flows[0]?.entry.id ?? "");
  const [selected, setSelected] = useState<FlowTraceNode | null>(null);
  const active = flows.find((f) => f.entry.id === activeId) ?? flows[0];
  if (!active) return null;

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
            onSelect={(n) => setSelected(n)}
          />
        </div>
      </div>

      {/* ---- selected node detail ---- */}
      {selected && (
        <div
          className="rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2"
          style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
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
            href={`/session/${sessionId}/source?file=${encodeURIComponent(selected.filePath)}`}
            className="text-[11px] inline-flex items-center gap-1 ml-auto hover:underline"
            style={{ color: TOK.accent }}
          >
            <FileCode2 size={12} />
            Open {basename(selected.filePath)}
          </Link>
        </div>
      )}

      {/* ---- honesty footer ---- */}
      <p className="text-[11px] leading-relaxed" style={{ color: TOK.textMuted }}>
        Each arrow means <strong style={{ color: TOK.textSecondary }}>calls</strong> — not
        &ldquo;and then&rdquo;. Columns are how many calls away something is, not the order things
        happen: the analysis reads structure, not execution, so branches and early returns
        aren&rsquo;t visible here.{" "}
        {resolution.pct < 100 && (
          <>
            {resolution.pct}% of this repo&rsquo;s {resolution.totalEdges.toLocaleString()} calls
            could be traced to a known function ({resolution.resolvedEdges.toLocaleString()}); calls
            into libraries, dynamic dispatch, and unparsed languages aren&rsquo;t drawn.
          </>
        )}
      </p>
    </div>
  );
}
