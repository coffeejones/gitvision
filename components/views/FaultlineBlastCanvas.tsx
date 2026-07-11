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
  MiniMap,
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
  const d = data as { label: string };
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
        Delete
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
        minWidth: 96,
        maxWidth: 168,
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

function build(epicenter: string, affected: AffectedFile[]): { nodes: Node[]; edges: Edge[] } {
  const shown = affected.slice(0, NODE_CAP);
  const byHop = new Map<number, AffectedFile[]>();
  for (const a of shown) {
    const arr = byHop.get(a.hop) ?? [];
    arr.push(a);
    byHop.set(a.hop, arr);
  }
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  const tallest = Math.max(1, ...[...byHop.values()].map((v) => v.length));
  const canvasMid = (tallest * ROW_H) / 2;

  const nodes: Node[] = [
    {
      id: "__epicenter",
      type: "epicenter",
      position: { x: 0, y: canvasMid - ROW_H / 2 },
      data: { label: baseName(epicenter) },
      draggable: false,
    },
  ];
  const edges: Edge[] = [];

  for (const h of hops) {
    const col = byHop.get(h)!;
    const x = h * COL_W;
    const startY = canvasMid - (col.length * ROW_H) / 2;
    col.forEach((a, i) => {
      nodes.push({
        id: a.path,
        type: "affected",
        position: { x, y: startY + i * ROW_H },
        data: { label: baseName(a.path), untested: a.untested, isTest: a.isTest },
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
  }
  return { nodes, edges };
}

// ---------------- component ----------------

export function FaultlineBlastCanvas({
  epicenter,
  affected,
}: {
  epicenter: string;
  affected: AffectedFile[];
}) {
  const { nodes, edges } = useMemo(() => build(epicenter, affected), [epicenter, affected]);

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
          {nodes.length > 20 && (
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(0,0,0,0.55)"
              style={{ background: TOK.bg, border: `1px solid ${TOK.border}` }}
              nodeColor={(n) =>
                (n.data as { untested?: boolean })?.untested ? TOK.rose : TOK.border
              }
            />
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
