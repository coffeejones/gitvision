"use client";

// The Faultline shockwave (F-2). A focused React Flow canvas: the deleted file
// as the epicenter, the files it takes down fanned out by hop distance, the
// untested ones pulsing red. Driven entirely by the SimulateResult's
// affectedFiles — no separate graph payload — so it's the deterministic "what
// breaks" made visual. (React Flow CSS is imported once in app/globals.css.)

import { memo, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { TOK } from "@/lib/sessionTheme";
import type { AffectedFile } from "@/lib/shadowGraph/simulate";

const CANVAS_H = 460;
const NODE_CAP = 50; // keep it legible; the card lists the full count
const COL_W = 215;
const ROW_H = 56;

// ---------------- custom nodes ----------------

const EpicenterNode = memo(function EpicenterNode({ data }: NodeProps) {
  const d = data as { label: string; verb?: string };
  return (
    <div
      style={{
        background: TOK.rose,
        color: TOK.bg,
        borderRadius: 10,
        padding: "10px 14px",
        maxWidth: 190,
        boxShadow: `0 0 0 4px ${TOK.roseSoft}, 0 6px 20px -6px ${TOK.rose}`,
      }}
    >
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.85 }}>
        {d.verb ?? "Delete"}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "var(--font-ct-mono, monospace)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {d.label}
      </div>
    </div>
  );
});

const AffectedNode = memo(function AffectedNode({ data }: NodeProps) {
  const d = data as { label: string; untested: boolean; isTest: boolean };
  const accent = d.untested ? TOK.rose : d.isTest ? TOK.textMuted : TOK.textSecondary;
  return (
    <div
      style={{
        background: d.untested ? TOK.roseSoft : TOK.surface,
        border: `1px solid ${d.untested ? `${TOK.rose}66` : TOK.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        minWidth: 110,
        maxWidth: 190,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-ct-mono, monospace)",
          color: TOK.textPrimary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {d.label}
      </div>
      <div style={{ fontSize: 9.5, color: accent, marginTop: 1 }}>
        {d.untested ? "no test" : d.isTest ? "guarding test" : "covered"}
      </div>
    </div>
  );
});

const NODE_TYPES = { epicenter: EpicenterNode, affected: AffectedNode } as const;

// ---------------- layout ----------------

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** Last two path segments — enough to tell apart the many same-named files
 *  (route.ts, index.ts, page.tsx) a repo has, without a full path. */
function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length <= 2 ? p : parts.slice(-2).join("/");
}

const ROWS_PER_COL = 8;

function build(
  epicenter: string,
  affected: AffectedFile[],
  verb: string,
): { nodes: Node[]; edges: Edge[] } {
  const shown = affected.slice(0, NODE_CAP);
  // All casualties are direct (hop 1) — lay them in a grid fan to the right of
  // the epicenter, wrapping into columns so a wide blast stays legible.
  const firstColCount = Math.min(ROWS_PER_COL, shown.length || 1);
  const canvasMid = (firstColCount * ROW_H) / 2;

  const nodes: Node[] = [
    {
      id: "__epicenter",
      type: "epicenter",
      position: { x: 0, y: canvasMid - ROW_H / 2 },
      data: { label: baseName(epicenter), verb },
      draggable: false,
    },
  ];
  const edges: Edge[] = [];

  shown.forEach((a, i) => {
    const col = Math.floor(i / ROWS_PER_COL);
    const row = i % ROWS_PER_COL;
    const colCount = Math.min(ROWS_PER_COL, shown.length - col * ROWS_PER_COL);
    const startY = canvasMid - (colCount * ROW_H) / 2;
    nodes.push({
      id: a.path,
      type: "affected",
      position: { x: (col + 1) * COL_W, y: startY + row * ROW_H },
      data: { label: shortPath(a.path), untested: a.untested, isTest: a.isTest },
      draggable: false,
    });
    edges.push({
      id: `e-${a.path}`,
      source: "__epicenter",
      target: a.path,
      // Untested casualties pulse red — the breaks nothing will catch.
      animated: a.untested,
      style: {
        stroke: a.untested ? TOK.rose : TOK.border,
        strokeWidth: a.untested ? 1.5 : 1,
        opacity: a.untested ? 0.9 : 0.5,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: a.untested ? TOK.rose : TOK.border },
    });
  });

  return { nodes, edges };
}

// ---------------- component ----------------

export function FaultlineBlastCanvas({
  epicenter,
  affected,
  verb = "Delete",
}: {
  epicenter: string;
  affected: AffectedFile[];
  /** The epicenter action label — "Delete" for Faultline, "Change" for what-if. */
  verb?: string;
}) {
  const { nodes, edges } = useMemo(
    () => build(epicenter, affected, verb),
    [epicenter, affected, verb],
  );

  if (affected.length === 0) {
    return (
      <div
        className="rounded-xl flex items-center justify-center text-center px-8"
        style={{ height: CANVAS_H, background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <p className="text-sm max-w-xs" style={{ color: TOK.textSecondary }}>
          Nothing depends on{" "}
          <span style={{ fontFamily: "var(--font-ct-mono, monospace)", color: TOK.textPrimary }}>
            {baseName(epicenter)}
          </span>{" "}
          — deleting it breaks nothing in the graph.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ height: CANVAS_H, background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background color={TOK.border} gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
