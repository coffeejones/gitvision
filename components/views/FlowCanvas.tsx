"use client";

// The Flows canvas — one entry point's reach, drawn left-to-right.
//
// Layout doctrine (why it looks like this):
//   - Columns are HOPS, not steps. Column 1 is "called directly by the entry
//     point", column 2 is "called by those", and so on. The x axis is distance,
//     never time. Copy elsewhere on the surface says "reaches", never "then" —
//     the graph has no control flow, so execution order is not knowable.
//   - Tidy-tree rows: leaves get consecutive rows, a parent sits at the mean of
//     its children. That makes each branch read as a group instead of a grid.
//   - Edges all encode the same fact (A calls B), so they are uniform: thin,
//     faint, no arrowheads, no animation. Nothing on an edge is severity.
//   - Complexity is the only per-node weight, shown as a small number, because
//     it is the one thing here that is computed rather than named.
// (React Flow CSS is imported once in app/globals.css.)

import { memo, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { TOK } from "@/lib/sessionTheme";
import type { FlowTrace, FlowTraceNode } from "@/lib/codeAnalysis/flowTrace";

const CANVAS_H = 560;
const COL_W = 216;
const ROW_H = 66;
const MONO = "var(--font-ct-mono, monospace)";

const basename = (p: string) => p.split("/").pop() ?? p;
const dirname = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

// ---------------- custom nodes ----------------

interface FlowNodeData extends Record<string, unknown> {
  name: string;
  filePath: string;
  complexity: number;
  elided: number;
  isRoot: boolean;
  selected: boolean;
}

const StepNode = memo(function StepNode({ data }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div
      style={{
        width: 184,
        minHeight: 52,
        padding: "8px 10px",
        borderRadius: 8,
        background: d.isRoot ? TOK.accentSoft : TOK.surface,
        border: `1px solid ${d.selected ? TOK.accent : d.isRoot ? TOK.accent : TOK.border}`,
        boxShadow: d.selected ? `0 0 0 1px ${TOK.accent}` : "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {!d.isRoot && <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            color: TOK.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {d.name}
        </span>
        {d.complexity > 1 && (
          <span style={{ fontSize: 10, color: TOK.textMuted, flexShrink: 0 }}>
            {d.complexity}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          color: TOK.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={d.filePath}
      >
        {basename(d.filePath)}
        {dirname(d.filePath) ? ` · ${dirname(d.filePath)}` : ""}
      </div>
      {d.elided > 0 && (
        <div style={{ fontSize: 10, color: TOK.textMuted }}>+{d.elided} more not shown</div>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

const nodeTypes = { step: StepNode };

// ---------------- layout ----------------

/** Tidy-tree rows: DFS assigns each leaf the next row; a parent sits at the mean
 *  of its children. Produces grouped branches instead of a grid. */
function layoutRows(trace: FlowTrace): Map<string, number> {
  const children = new Map<string, FlowTraceNode[]>();
  for (const n of trace.nodes) {
    if (!n.parentId) continue;
    const arr = children.get(n.parentId);
    if (arr) arr.push(n);
    else children.set(n.parentId, [n]);
  }
  const rows = new Map<string, number>();
  let nextLeafRow = 0;
  const visit = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      const r = nextLeafRow++;
      rows.set(id, r);
      return r;
    }
    const kidRows = kids.map((k) => visit(k.id));
    const r = (Math.min(...kidRows) + Math.max(...kidRows)) / 2;
    rows.set(id, r);
    return r;
  };
  visit(trace.rootId);
  return rows;
}

export function FlowCanvas({
  trace,
  selectedId,
  onSelect,
}: {
  trace: FlowTrace;
  selectedId?: string | null;
  onSelect?: (node: FlowTraceNode) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const rows = layoutRows(trace);
    const ns: Node[] = trace.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: { x: n.depth * COL_W, y: (rows.get(n.id) ?? 0) * ROW_H },
      data: {
        name: n.name,
        filePath: n.filePath,
        complexity: n.complexity,
        elided: n.elidedChildren,
        isRoot: n.parentId === null,
        selected: n.id === selectedId,
      } satisfies FlowNodeData,
      draggable: false,
    }));
    const es: Edge[] = trace.nodes
      .filter((n) => n.parentId)
      .map((n) => ({
        id: `${n.parentId}->${n.id}`,
        source: n.parentId as string,
        target: n.id,
        type: "smoothstep",
        style: { stroke: TOK.border, strokeWidth: 1 },
      }));
    return { nodes: ns, edges: es };
  }, [trace, selectedId]);

  const byId = useMemo(
    () => new Map(trace.nodes.map((n) => [n.id, n])),
    [trace]
  );

  return (
    // Explicit height: React Flow needs real dimensions at mount, and Tailwind
    // height classes have timing quirks with its measurement.
    <div style={{ height: CANVAS_H, width: "100%", background: TOK.bg }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            const n = byId.get(node.id);
            if (n && onSelect) onSelect(n);
          }}
        >
          <Background color={TOK.border} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
