"use client";

// The Faultline shockwave (F-2), readability rework. A focused React Flow
// canvas: the deleted file as the epicenter, the files it takes down fanned out
// to the right. Driven entirely by the SimulateResult's affectedFiles.
//
// Readability doctrine (why it looks calm now):
//   - Orange is NOT a surface. Every node is neutral bitumen; the only warm
//     pixels are the epicenter and a 3px rose inset LEFT stripe on the breaks
//     that no test catches. Covered files + guarding tests carry no stripe —
//     absence of orange = "something catches this".
//   - Edges all encode the SAME fact (a hop-1 dependent of the deleted file),
//     so they're uniform: thin, faint, straight, no arrowheads, no animation.
//     Severity lives 100% on the node stripe, never on a line.
//   - Two-line labels (basename bold + dir dim) + a lower node cap keep fitView
//     near 1:1 instead of shrinking 50 nodes to mush. The full count lives in
//     the brief card + casualty list; a "+N more" node keeps the cap honest.
//   - Every casualty is a real node: click it to open the file in Source.
// (React Flow CSS is imported once in app/globals.css.)

import { memo, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { CH } from "@/components/chambers/theme";
import type { AffectedFile } from "@/lib/shadowGraph/simulate";

const CANVAS_H = 520;
const NODE_CAP = 24; // ~1:1 under fitView; the card + list hold the full count
const COL_W = 250; // card is 208 → ~42px horizontal gap between columns
const ROW_H = 86; // card min-height 56 → ~30px vertical gap between rows
const ROWS_PER_COL = 6;
const MONO = "var(--font-ct-mono, monospace)";

// ---------------- custom nodes ----------------

const EpicenterNode = memo(function EpicenterNode({ data }: NodeProps) {
  const d = data as { base: string; dir: string; verb?: string };
  return (
    <div
      style={{
        background: TOK.rose,
        color: TOK.bg,
        borderRadius: 10,
        padding: "10px 14px",
        width: 190,
        boxShadow: "0 4px 14px -6px rgba(0,0,0,0.5)",
      }}
    >
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.85 }}>
        {d.verb ?? "Delete"}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {d.base}
      </div>
      {d.dir && (
        <div style={{ fontSize: 9.5, fontFamily: MONO, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {d.dir}
        </div>
      )}
    </div>
  );
});

// Untested nodes must POP — they're the whole point ("breaks, no test catches
// it"). Warmth is layered but the orange never becomes a full fill: a faint
// left gradient + a 4px stripe + a filled rose "no test" chip. Covered + tests
// stay fully neutral, so the danger reads instantly against them.
const UNTESTED_BG = `linear-gradient(90deg, ${TOK.roseSoft} 0%, transparent 55%), ${TOK.surface}`;

const AffectedNode = memo(function AffectedNode({ data }: NodeProps) {
  const d = data as { base: string; dir: string; untested: boolean; isTest: boolean; href?: string };
  const restBg = d.untested ? UNTESTED_BG : TOK.surface;
  const clickable = !!d.href;
  return (
    <div
      style={{
        background: restBg,
        border: `1px solid ${d.untested ? `${TOK.rose}44` : TOK.border}`,
        borderRadius: 8,
        width: 208,
        minHeight: 56,
        padding: "8px 11px",
        boxShadow: d.untested ? `inset 4px 0 0 ${TOK.rose}` : "none",
        cursor: clickable ? "pointer" : "default",
        transition: "border-color 0.12s ease, filter 0.12s ease",
      }}
      onMouseEnter={(e) => {
        if (!clickable) return;
        e.currentTarget.style.filter = "brightness(1.15)";
        e.currentTarget.style.borderColor = d.untested ? `${TOK.rose}88` : TOK.borderStrong;
      }}
      onMouseLeave={(e) => {
        if (!clickable) return;
        e.currentTarget.style.filter = "none";
        e.currentTarget.style.borderColor = d.untested ? `${TOK.rose}44` : TOK.border;
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: MONO, color: TOK.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {d.base}
      </div>
      {d.dir && (
        <div style={{ fontSize: 10, fontFamily: MONO, color: TOK.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {d.dir}
        </div>
      )}
      {d.untested ? (
        <span
          style={{
            display: "inline-block",
            marginTop: 3,
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: TOK.rose,
            background: TOK.roseSoft,
            border: `1px solid ${TOK.rose}55`,
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          no test
        </span>
      ) : (
        <div style={{ fontSize: 9.5, letterSpacing: "0.08em", color: TOK.textMuted, marginTop: 3 }}>
          {d.isTest ? "guarding test" : "covered"}
        </div>
      )}
    </div>
  );
});

const SummaryNode = memo(function SummaryNode({ data }: NodeProps) {
  const d = data as { label: string };
  return (
    <div
      style={{
        background: TOK.surface,
        border: `1px dashed ${TOK.border}`,
        borderRadius: 8,
        width: 208,
        minHeight: 56,
        padding: "8px 11px",
        display: "flex",
        alignItems: "center",
        color: TOK.textMuted,
        fontSize: 12,
        fontFamily: MONO,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {d.label}
    </div>
  );
});

const NODE_TYPES = { epicenter: EpicenterNode, affected: AffectedNode, summary: SummaryNode } as const;

// ---------------- layout ----------------

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** The parent directory, left-biased so the meaningful tail survives:
 *  "a/b/c/d/CodePanel.tsx" -> "…/c/d". "" for a root-level file. */
function dirOf(p: string): string {
  const parts = p.split("/");
  parts.pop();
  if (parts.length === 0) return "";
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

function build(
  epicenter: string,
  affected: AffectedFile[],
  verb: string,
  sessionId?: string,
): { nodes: Node[]; edges: Edge[] } {
  const shown = affected.slice(0, NODE_CAP);
  const firstColCount = Math.min(ROWS_PER_COL, shown.length || 1);
  const canvasMid = (firstColCount * ROW_H) / 2;

  const nodes: Node[] = [
    {
      id: "__epicenter",
      type: "epicenter",
      position: { x: 0, y: canvasMid - ROW_H / 2 },
      data: { base: baseName(epicenter), dir: dirOf(epicenter), verb },
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
      data: {
        base: baseName(a.path),
        dir: dirOf(a.path),
        untested: a.untested,
        isTest: a.isTest,
        href: sessionId
          ? `/session/${sessionId}/source?file=${encodeURIComponent(a.path)}&line=1`
          : undefined,
      },
      draggable: false,
    });
    // Edges are quiet hairlines (no arrowheads, no animation — those were the
    // "wall"). Untested get a faint ROSE line so the danger also radiates warm,
    // not just the neutral grey of a covered break; covered stay neutral.
    edges.push({
      id: `e-${a.path}`,
      source: "__epicenter",
      target: a.path,
      type: "straight",
      style: a.untested
        ? { stroke: TOK.rose, strokeWidth: 1.25, opacity: 0.32 }
        : { stroke: TOK.border, strokeWidth: 1, opacity: 0.22 },
    });
  });

  // "+N more" keeps the cap honest — never let it imply "only N break".
  const hidden = affected.length - shown.length;
  if (hidden > 0) {
    const hiddenUntested = affected.slice(NODE_CAP).filter((a) => a.untested).length;
    const lastCol = Math.floor((shown.length - 1) / ROWS_PER_COL) + 1;
    const lastRowCount = shown.length - (lastCol - 1) * ROWS_PER_COL;
    nodes.push({
      id: "__more",
      type: "summary",
      position: {
        x: lastCol * COL_W,
        y: canvasMid - (Math.min(ROWS_PER_COL, lastRowCount + 1) * ROW_H) / 2 + lastRowCount * ROW_H,
      },
      data: {
        label: hiddenUntested > 0 ? `+${hidden} more · ${hiddenUntested} untested` : `+${hidden} more`,
      },
      draggable: false,
    });
  }

  return { nodes, edges };
}

// ---------------- component ----------------

export function FaultlineBlastCanvas({
  epicenter,
  affected,
  verb = "Delete",
  sessionId,
}: {
  epicenter: string;
  affected: AffectedFile[];
  /** The epicenter action label — "Delete" for Faultline, "Change" for what-if. */
  verb?: string;
  /** When present, each casualty node clicks through to the Source view. */
  sessionId?: string;
}) {
  const router = useRouter();
  const { nodes, edges } = useMemo(
    () => build(epicenter, affected, verb, sessionId),
    [epicenter, affected, verb, sessionId],
  );

  if (affected.length === 0) {
    return (
      <div
        className="rounded-xl flex items-center justify-center text-center px-8"
        style={{ height: CANVAS_H, background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        <p className="text-sm max-w-xs" style={{ color: TOK.textSecondary }}>
          Nothing depends on{" "}
          <span style={{ fontFamily: MONO, color: TOK.textPrimary }}>
            {baseName(epicenter)}
          </span>{" "}
          — deleting it breaks nothing in the graph.
        </p>
      </div>
    );
  }

  return (
    <div
      className="ct-blast rounded-xl overflow-hidden"
      style={{ height: CANVAS_H, background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      {/* React Flow makes nodes focusable (tabindex 0) and only resets the focus
          outline on .selectable nodes — ours aren't selectable, so they'd inherit
          the app's focus ring. Kill it; the hover feedback + the casualty list
          (keyboard-accessible) carry interaction. */}
      <style>{`.ct-blast .react-flow__node { outline: none !important; }`}</style>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          minZoom={0.2}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => {
            const href = (n.data as { href?: string })?.href;
            if (href) router.push(href);
          }}
        >
          <Background color={TOK.border} gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
