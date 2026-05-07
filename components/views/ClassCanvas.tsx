"use client";

// Interactive class canvas for the Architecture tab (v0.72).
//
// ReactFlow-based replacement for Mermaid's classDiagram in the
// in-app browsing path. Mermaid stays available as a "Copy as
// Mermaid" side-feature for shareability (paste into README,
// blog, mermaid.live), but BROWSING the structure happens here:
//   - Drag/zoom/pan built-in via ReactFlow
//   - Click a class to highlight neighbors (incoming + outgoing
//     edges glow, unrelated classes dim)
//   - Hover for the file path (the affordance we removed from
//     Mermaid's always-visible notes — file path lives here on-
//     demand without polluting the layout)
//   - Custom node rendering uses TOK theme tokens for consistency
//     with the rest of the app
//
// The data transformation + Dagre layout is in
// lib/intelligence/classCanvas.ts — keep this file focused on
// rendering. That separation makes the layout pass unit-testable
// without spinning up a DOM.

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useDeferredValue,
  type CSSProperties,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from "@xyflow/react";
import { Search, X } from "lucide-react";
import type { CodeGraph } from "@/lib/types";
import type { ParsedField } from "@/lib/codeAnalysis/types";
import {
  buildClassCanvas,
  layoutDagre,
  type ClassEdgeData,
  type ClassNodeData,
} from "@/lib/intelligence/classCanvas";
import { TOK } from "@/lib/theme";

interface Props {
  codeGraph: CodeGraph;
  scope?:
    | { kind: "all" }
    | { kind: "file"; filePath: string }
    | { kind: "folder"; folder: string };
}

// ReactFlow's data shape extension lives here so both the parent
// component and the per-node renderer use the same type. The
// underscore-prefixed fields are transient render-state — derived
// from selection, not part of the canonical data model.
interface AugmentedClassNodeData extends ClassNodeData {
  _isSelected?: boolean;
  _isDimmed?: boolean;
}

interface AugmentedClassEdgeData extends ClassEdgeData {
  _highlighted?: boolean;
}

// Stereotype palette — single source of truth for "what color is
// this kind of class". Used in both the node header and the
// stereotype badge.
const STEREOTYPE_STYLE = {
  interface: { accent: "#60a5fa", label: "interface" }, // blue
  abstract: { accent: "#a78bfa", label: "abstract" }, // violet
  enum: { accent: "#f59e0b", label: "enumeration" }, // amber
  class: { accent: TOK.accent, label: "class" }, // emerald
} as const;

// Edge color/style by kind. Matches UML conventions:
//   extends: solid line, filled triangle (inheritance)
//   implements: dashed line, filled triangle (realization)
//   association: solid line, open arrow + label (uses)
const EDGE_STYLE = {
  extends: { stroke: "#a78bfa", dashed: false },
  implements: { stroke: "#60a5fa", dashed: true },
  association: { stroke: TOK.textSecondary, dashed: false },
} as const;

export function ClassCanvas({ codeGraph, scope }: Props) {
  return (
    <ReactFlowProvider>
      <ClassCanvasInner codeGraph={codeGraph} scope={scope} />
    </ReactFlowProvider>
  );
}

function ClassCanvasInner({ codeGraph, scope }: Props) {
  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildClassCanvas(codeGraph, { scope }),
    [codeGraph, scope]
  );
  const [selected, setSelected] = useState<string | null>(null);

  // v0.72 controls:
  //   - hideUnconnected: filter to classes with at least one edge.
  //     Big win on TS/React-heavy repos with many Props/State
  //     interfaces — those rarely have outgoing edges and tend to
  //     dominate the layout horizontally.
  //   - searchQuery: substring match on class name. Complements the
  //     filter above so users can still find an unconnected class
  //     by name when needed.
  const [hideUnconnected, setHideUnconnected] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  // useDeferredValue keeps the input snappy while debouncing the
  // expensive filter+layout recompute behind it.
  const searchQuery = useDeferredValue(searchInput);

  const reactFlow = useReactFlow();

  // Pre-compute the connected-id set once per edge change. Used by
  // both the unconnected filter and various downstream hints.
  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of rawEdges) {
      s.add(e.source);
      s.add(e.target);
    }
    return s;
  }, [rawEdges]);

  // Resolve the visible-node-ID set after applying both filters.
  // Edges then survive only when BOTH endpoints survive — pruning
  // half-rendered orphans.
  const visibleIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const out = new Set<string>();
    for (const n of rawNodes) {
      if (hideUnconnected && !connectedIds.has(n.id)) continue;
      if (q && !n.id.toLowerCase().includes(q)) continue;
      out.add(n.id);
    }
    return out;
  }, [rawNodes, hideUnconnected, searchQuery, connectedIds]);

  // Filtered raw collections for downstream use (neighbor resolution
  // works against the FILTERED edge set so a class hidden by the
  // filter doesn't claim to be a neighbor of a visible one).
  const filteredEdges = useMemo(
    () =>
      rawEdges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
      ),
    [rawEdges, visibleIds]
  );

  // v0.72: re-run Dagre on the filtered set whenever filters change.
  // Without this, the canvas keeps positions from the initial full-set
  // layout — visible nodes stay scattered across the wide original
  // bounding box, with hidden nodes leaving giant gaps. Re-layout
  // packs the visible-only set tightly, killing the "scroll for ages"
  // problem that surfaced on GitVision's own codebase (many isolated
  // Props/State interfaces).
  const positions = useMemo(() => {
    if (visibleIds.size === rawNodes.length) {
      // No filtering active — reuse the initial layout from
      // buildClassCanvas, no need to re-run Dagre.
      return null;
    }
    const visibleNodeMeta = rawNodes
      .filter((n) => visibleIds.has(n.id))
      .map((n) => ({ id: n.id, width: n.width, height: n.height }));
    return layoutDagre(visibleNodeMeta, filteredEdges);
  }, [rawNodes, visibleIds, filteredEdges]);

  // Compute neighbors of the selected node so we can dim unrelated
  // classes and highlight related edges. Same pattern as Imports'
  // DependencyCanvas — feels familiar to anyone who's used that
  // tab.
  const neighbors = useMemo(() => {
    if (!selected) return null;
    const ns = new Set<string>([selected]);
    for (const e of filteredEdges) {
      if (e.source === selected) ns.add(e.target);
      if (e.target === selected) ns.add(e.source);
    }
    return ns;
  }, [selected, filteredEdges]);

  const nodes: Node<AugmentedClassNodeData>[] = useMemo(() => {
    return rawNodes
      .filter((n) => visibleIds.has(n.id))
      .map((n) => {
        const isSelected = selected === n.id;
        const isDimmed = neighbors !== null && !neighbors.has(n.id);
        // Use re-laid-out position when filters are active, otherwise
        // the initial buildClassCanvas position is correct.
        const pos = positions?.get(n.id) ?? n.position;
        return {
          id: n.id,
          type: "class",
          position: pos,
          data: { ...n.data, _isSelected: isSelected, _isDimmed: isDimmed },
          // ReactFlow uses this for viewport calculations even when
          // the actual rendered size differs — stick close to the
          // Dagre estimate.
          width: n.width,
          height: n.height,
        };
      });
  }, [rawNodes, visibleIds, selected, neighbors, positions]);

  const edges: Edge<AugmentedClassEdgeData>[] = useMemo(() => {
    return filteredEdges.map((e) => {
      const isHighlighted =
        selected !== null &&
        (e.source === selected || e.target === selected);
      const style = EDGE_STYLE[e.data.kind];
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "class",
        data: { ...e.data, _highlighted: isHighlighted },
        markerEnd: {
          type:
            e.data.kind === "association"
              ? MarkerType.Arrow
              : MarkerType.ArrowClosed,
          color: style.stroke,
          width: 18,
          height: 18,
        },
        style: {
          stroke: style.stroke,
          strokeWidth: isHighlighted ? 2.5 : 1.5,
          strokeDasharray: style.dashed ? "5 4" : undefined,
          opacity: selected === null || isHighlighted ? 1 : 0.18,
        },
      };
    });
  }, [filteredEdges, selected]);

  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      setSelected((prev) => (prev === node.id ? null : node.id));
    },
    []
  );

  const onPaneClick = useCallback(() => setSelected(null), []);

  // Re-fit viewport when the visible set changes — without this, the
  // canvas keeps its previous zoom/pan and the user has to hand-pan
  // back to find the now-fewer nodes.
  useEffect(() => {
    if (visibleIds.size === 0) return;
    const t = setTimeout(() => {
      reactFlow.fitView({ padding: 0.15, duration: 250 });
    }, 50);
    return () => clearTimeout(t);
    // visibleIds drives the recompute; reactFlow handle is stable.
  }, [visibleIds, reactFlow]);

  if (rawNodes.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed p-8 text-center text-sm"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        No classes to render.
      </div>
    );
  }

  const hiddenCount = rawNodes.length - visibleIds.size;

  return (
    <div className="flex flex-col gap-2">
      <CanvasControls
        hideUnconnected={hideUnconnected}
        onToggleUnconnected={() => setHideUnconnected((v) => !v)}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        totalCount={rawNodes.length}
        visibleCount={visibleIds.size}
        hiddenCount={hiddenCount}
      />
      <div
        style={{
          width: "100%",
          height: 600,
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
          borderRadius: 12,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {visibleIds.size === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: TOK.textMuted, zIndex: 5 }}
          >
            No classes match the current filters.
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          // Drag intentionally disabled. Dagre's auto-layout is the
          // canonical view; letting users drag boxes around added a
          // feature without value (positions don't persist, the next
          // refresh recomputes layout). Click-to-highlight is the
          // primary interaction; zoom/pan handle navigation.
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color={TOK.border} gap={24} size={1} />
          <Controls
            showInteractive={false}
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              borderRadius: 8,
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

/** v0.72: controls bar above the canvas. Holds the "Hide unconnected"
 *  toggle and a substring search input. Surfaces a "showing N of M"
 *  hint so users see the filter is active. */
function CanvasControls({
  hideUnconnected,
  onToggleUnconnected,
  searchInput,
  onSearchChange,
  totalCount,
  visibleCount,
  hiddenCount,
}: {
  hideUnconnected: boolean;
  onToggleUnconnected: () => void;
  searchInput: string;
  onSearchChange: (v: string) => void;
  totalCount: number;
  visibleCount: number;
  hiddenCount: number;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md flex-1 min-w-[180px] max-w-xs"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <Search size={12} style={{ color: TOK.textMuted, flexShrink: 0 }} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter classes by name…"
          className="bg-transparent outline-none text-xs flex-1 min-w-0"
          style={{ color: TOK.textPrimary }}
        />
        {searchInput && (
          <button
            onClick={() => onSearchChange("")}
            className="cursor-pointer flex-shrink-0"
            style={{ color: TOK.textMuted }}
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Hide unconnected toggle */}
      <label
        className="flex items-center gap-2 text-xs cursor-pointer select-none"
        style={{ color: TOK.textSecondary }}
      >
        <input
          type="checkbox"
          checked={hideUnconnected}
          onChange={onToggleUnconnected}
          className="cursor-pointer"
        />
        Hide unconnected
      </label>

      {/* Visibility hint — only when filtering hides something */}
      {hiddenCount > 0 && (
        <span className="text-xs ml-auto" style={{ color: TOK.textMuted }}>
          {visibleCount} of {totalCount} shown
        </span>
      )}
    </div>
  );
}

// ---------------- Custom node ----------------

function ClassNode({ data }: NodeProps<Node<AugmentedClassNodeData>>) {
  const stereotype = data.isEnum
    ? STEREOTYPE_STYLE.enum
    : data.isInterface
    ? STEREOTYPE_STYLE.interface
    : data.isAbstract
    ? STEREOTYPE_STYLE.abstract
    : STEREOTYPE_STYLE.class;
  const isSelected = data._isSelected ?? false;
  const isDimmed = data._isDimmed ?? false;

  const cardStyle: CSSProperties = {
    width: 240,
    background: TOK.surfaceElevated,
    border: `1px solid ${
      isSelected ? stereotype.accent : TOK.border
    }`,
    borderRadius: 10,
    boxShadow: isSelected
      ? `0 0 0 2px ${stereotype.accent}33`
      : "0 2px 8px rgba(0,0,0,0.25)",
    opacity: isDimmed ? 0.25 : 1,
    transition: "opacity 120ms ease, box-shadow 120ms ease",
    fontSize: 12,
    color: TOK.textPrimary,
    overflow: "hidden",
    // Pointer cursor signals click-to-highlight (the primary
    // interaction); userSelect:none prevents accidental text
    // selection when the user click-drags slightly without meaning
    // to highlight text inside a field row.
    cursor: "pointer",
    userSelect: "none",
  };

  return (
    <div style={cardStyle} title={data.filePath}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      {/* Header: class name + stereotype badge */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${TOK.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: `${stereotype.accent}22`,
              color: stereotype.accent,
              border: `1px solid ${stereotype.accent}44`,
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
          >
            {stereotype.label}
          </span>
        </div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: TOK.textPrimary,
            wordBreak: "break-word",
          }}
        >
          {data.label}
        </div>
      </div>

      {/* Body: enum values, OR fields + methods */}
      {data.isEnum ? (
        <div style={bodyStyle}>
          {data.enumValues.length === 0 ? (
            <RowMuted text="(no values)" />
          ) : (
            data.enumValues.map((v, i) => (
              <div key={`v${i}`} style={rowStyle}>
                <span style={{ color: TOK.textPrimary }}>{v}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={bodyStyle}>
          {data.fields.length === 0 && data.methodNames.length === 0 ? (
            <RowMuted text="(empty)" />
          ) : (
            <>
              {data.fields.map((f, i) => (
                <FieldRow key={`f${i}`} field={f} />
              ))}
              {data.fields.length > 0 && data.methodNames.length > 0 && (
                <div
                  style={{
                    height: 1,
                    background: TOK.border,
                    margin: "4px 0",
                  }}
                />
              )}
              {data.methodNames.map((name, i) => (
                <div key={`m${i}`} style={rowStyle}>
                  <span style={{ color: TOK.accent, fontFamily: "monospace" }}>
                    +
                  </span>
                  <span
                    style={{ color: TOK.textPrimary, fontFamily: "monospace" }}
                  >
                    {name}()
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

const bodyStyle: CSSProperties = {
  padding: "6px 10px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 4,
  fontSize: 11,
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function RowMuted({ text }: { text: string }) {
  return (
    <div style={{ ...rowStyle, color: TOK.textMuted, fontStyle: "italic" }}>
      {text}
    </div>
  );
}

function FieldRow({ field }: { field: ParsedField }) {
  const visGlyph = visToGlyph(field.visibility);
  const visColor =
    field.visibility === "private"
      ? TOK.rose
      : field.visibility === "protected"
      ? TOK.amber
      : field.visibility === "internal"
      ? TOK.textMuted
      : TOK.accent;
  return (
    <div style={rowStyle}>
      <span style={{ color: visColor }}>{visGlyph}</span>
      <span
        style={{
          color: TOK.textPrimary,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {field.name}
      </span>
      {field.type && (
        <span
          style={{
            color: TOK.textMuted,
            marginLeft: "auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 110,
          }}
          title={field.type}
        >
          {field.type}
        </span>
      )}
    </div>
  );
}

function visToGlyph(v: ParsedField["visibility"]): string {
  switch (v) {
    case "public":
      return "+";
    case "private":
      return "−";
    case "protected":
      return "#";
    case "internal":
      return "~";
    default:
      return "+";
  }
}

const NODE_TYPES = Object.freeze({ class: ClassNode });

// ---------------- Custom edge with label ----------------

function ClassEdge(props: EdgeProps<Edge<AugmentedClassEdgeData>>) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style,
    markerEnd,
  } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.kind === "association" && data.fieldName && (
        <EdgeLabelRenderer>
          <div
            style={{
              // EdgeLabelRenderer drops content into a layer that sits
              // BELOW node z-index by default, so a label whose midpoint
              // happens to land on top of an unrelated class box gets
              // visually obscured. Forcing high z-index + opaque
              // background pulls labels to the front so they read at
              // any zoom level.
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 1000,
              fontSize: 10,
              fontFamily: "monospace",
              padding: "2px 7px",
              borderRadius: 4,
              background: TOK.surfaceElevated,
              color: TOK.textSecondary,
              border: `1px solid ${TOK.border}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              pointerEvents: "none",
              opacity: data._highlighted ? 1 : 0.85,
              whiteSpace: "nowrap",
            }}
          >
            {data.fieldName}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES = Object.freeze({ class: ClassEdge });
