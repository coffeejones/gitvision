"use client";

// Dependency Canvas — renders a FileGraph as a layered, brick-stagger grid.
//
// Scale strategy for big repos: *filtering*, not aggregation.
//   - Hide test files — default on; they dominate the fan-in of shared hubs
//   - Hide isolated files (no incoming or outgoing edges) — default on for >100 files
//   - Text filter — paths not matching are hidden
//   - Minimap — default on for >100 files so you can navigate
//   - Click a file → FOCUS mode: prune to that file's N-hop neighborhood
//     (a readable local subgraph) instead of dimming the whole graph. The
//     external impact overlay from the panel above still dims rather than
//     prunes — two levels: soft highlight on the full map vs. zoom-in on click.
//
// Layout: BFS depth layers, adaptive cols-per-row with brick stagger for
// an organic "pyramid" feel.

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, Crosshair, Minus, Network, Plus, X } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { MUTED, VIZ_NEUTRAL, VIZ_SURFACE } from "@/lib/vizPalette";
import { EmptyPanel } from "@/components/EmptyPanel";
import { neighborhood, type FocusDirection } from "@/lib/graphFocus";
import { isTestFile } from "@/lib/codeAnalysis/testCoverage";
import type { ImpactHighlight } from "@/lib/impact";
import type {
  FileGraph,
  FileGraphEdge,
  FileGraphEdgeKind,
} from "@/lib/types";

// ------------------- Visual tokens -------------------

const EXT_STYLE: Record<
  string,
  { bg: string; ring: string; text: string; lang: string }
> = {
  // Muted categorical (lib/vizPalette) + the per-language label. Related
  // languages share a hue; unknown extensions fall back to neutral grey.
  tsx: { ...MUTED.teal, lang: "TSX" },
  ts: { ...MUTED.blue, lang: "TS" },
  js: { ...MUTED.sand, lang: "JS" },
  jsx: { ...MUTED.sand, lang: "JSX" },
  mjs: { ...MUTED.sand, lang: "MJS" },
  cjs: { ...MUTED.sand, lang: "CJS" },
  py: { ...MUTED.blue, lang: "Py" },
  go: { ...MUTED.teal, lang: "Go" },
  rs: { ...MUTED.clay, lang: "Rust" },
  java: { ...MUTED.rose, lang: "Java" },
  kt: { ...MUTED.plum, lang: "Kotlin" },
  cs: { ...MUTED.sage, lang: "C#" },
  php: { ...MUTED.plum, lang: "PHP" },
  rb: { ...MUTED.rose, lang: "Ruby" },
  html: { ...MUTED.clay, lang: "HTML" },
  css: { ...MUTED.plum, lang: "CSS" },
};
const FALLBACK = { ...VIZ_NEUTRAL, lang: "?" };

// Edge colours by kind — the muted node hues at low alpha, so edges read as
// quiet connective tissue, not loud wires. Dash distinguishes renders /
// implements without adding colour.
const EDGE_COLOR: Record<
  FileGraphEdgeKind,
  { stroke: string; strokeDim: string; dash?: string }
> = {
  import: {
    stroke: "rgba(110, 140, 168, 0.9)",
    strokeDim: "rgba(110, 140, 168, 0.18)",
  },
  renders: {
    stroke: "rgba(137, 155, 121, 0.95)",
    strokeDim: "rgba(137, 155, 121, 0.5)",
    dash: "5 3",
  },
  extends: {
    stroke: "rgba(154, 132, 153, 0.95)",
    strokeDim: "rgba(154, 132, 153, 0.4)",
  },
  implements: {
    stroke: "rgba(154, 132, 153, 0.95)",
    strokeDim: "rgba(154, 132, 153, 0.4)",
    dash: "2 3",
  },
};

const KIND_LABEL: Record<FileGraphEdgeKind, string> = {
  import: "Imports",
  renders: "Renders",
  extends: "Extends",
  implements: "Implements",
};

// ------------------- File node -------------------

interface FileNodeData extends Record<string, unknown> {
  path: string;
  ext: string;
  inDegree: number;
  outDegree: number;
  isSelected: boolean;
  isDimmed: boolean;
  isEntry: boolean;
  onSelect: (p: string) => void;
}

const handleStyle = { opacity: 0, pointerEvents: "none" as const };

const FileNode = memo(function FileNode({ data }: NodeProps) {
  const {
    path,
    ext,
    inDegree,
    outDegree,
    isSelected,
    isDimmed,
    isEntry,
    onSelect,
  } = data as FileNodeData;
  const c = EXT_STYLE[ext] ?? FALLBACK;
  const name = path.split("/").pop() || path;
  const parts = path.split("/");
  const dir = parts.length > 1 ? parts.slice(-3, -1).join("/") : "";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path);
      }}
      className={`rounded-lg border cursor-pointer select-none transition-opacity ${
        isDimmed ? "opacity-15" : "opacity-100"
      }`}
      style={{
        background: c.bg,
        borderColor: isSelected ? VIZ_SURFACE.selected : c.ring,
        borderWidth: isSelected ? 2 : 1,
        width: 220,
        padding: "7px 10px",
        boxShadow: isSelected
          ? "0 0 0 3px rgba(255,255,255,0.15)"
          : isEntry
          ? `0 0 0 1px ${c.ring}66`
          : "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: c.ring }}
        />
        <span
          className="font-mono text-[11px] leading-tight truncate"
          style={{ color: c.text }}
          title={path}
        >
          {name}
        </span>
        <span
          className="ml-auto text-[9px] font-mono uppercase tracking-wider shrink-0"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {c.lang}
        </span>
      </div>
      {dir && (
        <div
          className="text-[9px] font-mono mt-0.5 truncate"
          style={{ color: "rgba(255,255,255,0.4)" }}
          title={parts.slice(0, -1).join("/")}
        >
          …/{dir}
        </div>
      )}
      <div
        className="mt-1 flex items-center gap-3 text-[9px] font-mono"
        style={{ color: "rgba(255,255,255,0.6)" }}
      >
        <span title="files this imports">↓ {outDegree}</span>
        <span title="files that import this">↑ {inDegree}</span>
        {isEntry && (
          <span
            className="ml-auto px-1.5 rounded"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
            }}
          >
            entry
          </span>
        )}
      </div>
    </div>
  );
});

const NODE_TYPES = Object.freeze({ file: FileNode });

// ------------------- Layout -------------------

const NODE_W = 220;
const NODE_GAP_X = 40;
const ROW_H = 96;
const LAYER_GAP = 120;
const MAX_PER_ROW_CAP = 26;

// Focus mode: cap the neighborhood so a hub file (e.g. a 51-importer types.ts)
// doesn't re-explode into the same hairball. Nearest hops are kept first.
const FOCUS_CAP = 60;

function layeredPositions(
  ids: string[],
  edges: Array<{ from: string; to: string }>
): Map<string, { x: number; y: number; layer: number }> {
  const incoming = new Map<string, Set<string>>();
  for (const id of ids) incoming.set(id, new Set());
  for (const e of edges) {
    if (!incoming.has(e.to) || !incoming.has(e.from)) continue;
    incoming.get(e.to)!.add(e.from);
  }

  const layer = new Map<string, number>();
  function compute(id: string, visiting: Set<string>): number {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let l = 0;
    for (const src of incoming.get(id) ?? []) {
      l = Math.max(l, compute(src, visiting) + 1);
    }
    visiting.delete(id);
    layer.set(id, l);
    return l;
  }
  for (const id of ids) compute(id, new Set());

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(id);
    byLayer.set(l, arr);
  }
  for (const [, arr] of byLayer) arr.sort();

  const widest = Math.max(0, ...[...byLayer.values()].map((a) => a.length));
  // Small sets (a focused neighborhood, or a tiny repo) pack tighter: the
  // 6-per-row floor is tuned for wide global layers and would spread a
  // 4-node layer across the whole canvas, leaving a pruned view looking
  // broken. Drop the floor to 3 below 40 nodes.
  const rowFloor = ids.length < 40 ? 3 : 6;
  const maxPerRow = Math.max(
    rowFloor,
    Math.min(MAX_PER_ROW_CAP, Math.ceil(Math.sqrt(widest * 3)))
  );

  const step = NODE_W + NODE_GAP_X;
  const out = new Map<string, { x: number; y: number; layer: number }>();
  const maxLayer = Math.max(0, ...byLayer.keys());
  let yCursor = 0;
  for (let l = 0; l <= maxLayer; l++) {
    const arr = byLayer.get(l) ?? [];
    const rows = Math.max(1, Math.ceil(arr.length / maxPerRow));
    for (let r = 0; r < rows; r++) {
      const start = r * maxPerRow;
      const end = Math.min(start + maxPerRow, arr.length);
      const count = end - start;
      const totalW = count * NODE_W + (count - 1) * NODE_GAP_X;
      const stagger = r % 2 === 1 ? step / 2 : 0;
      const startX = -totalW / 2 + stagger;
      for (let i = 0; i < count; i++) {
        out.set(arr[start + i], {
          x: startX + i * step,
          y: yCursor + r * ROW_H,
          layer: l,
        });
      }
    }
    yCursor += rows * ROW_H + LAYER_GAP;
  }
  return out;
}

// ------------------- Component -------------------

interface Props {
  graph: FileGraph;
  /** External impact overlay (from the ImpactExplorer): the changed file +
   *  every file its change reaches. When set, nodes outside the blast are
   *  dimmed and the target reads as selected. The canvas's own click-to-
   *  isolate takes precedence while a node is selected; a toolbar toggle
   *  lets the user switch the overlay off locally. */
  impactHighlight?: ImpactHighlight | null;
}

function DependencyCanvasInner({ graph, impactHighlight }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [overlayOn, setOverlayOn] = useState(true);
  const [filterInput, setFilterInput] = useState("");
  const filter = useDeferredValue(filterInput.trim().toLowerCase());
  const bigRepo = graph.nodes.length > 100;
  const [hideIsolated, setHideIsolated] = useState(bigRepo);
  const [showMinimap, setShowMinimap] = useState(bigRepo);
  // Test files dominate the fan-in of shared hubs (they import the modules
  // under test), so they're the single biggest source of clutter — hidden by
  // default, toggleable back on.
  const [hideTests, setHideTests] = useState(true);
  // Focus-mode controls, active once a node is clicked.
  const [hopDepth, setHopDepth] = useState(2);
  const [direction, setDirection] = useState<FocusDirection>("both");
  const { fitView } = useReactFlow();

  const presentKinds = useMemo(() => {
    const s = new Set<FileGraphEdgeKind>();
    for (const e of graph.edges) s.add(e.kind);
    return s;
  }, [graph.edges]);

  const [enabledKinds, setEnabledKinds] = useState<
    Record<FileGraphEdgeKind, boolean>
  >({
    import: true,
    renders: true,
    extends: true,
    implements: true,
  });

  const testCount = useMemo(
    () => graph.nodes.filter((n) => isTestFile(n.path)).length,
    [graph.nodes]
  );

  // Edges the focus BFS may traverse — test edges removed when tests are
  // hidden, so the neighborhood never spends its cap on nodes we won't render.
  const focusEdges = useMemo(
    () =>
      hideTests
        ? graph.edges.filter((e) => !isTestFile(e.from) && !isTestFile(e.to))
        : graph.edges,
    [graph.edges, hideTests]
  );

  // Focus mode: a click prunes the canvas to the selected file's N-hop
  // neighborhood instead of dimming everything. null when nothing is selected.
  const focus = useMemo(
    () =>
      selected
        ? neighborhood(focusEdges, selected, {
            depth: hopDepth,
            direction,
            maxNodes: FOCUS_CAP,
          })
        : null,
    [selected, focusEdges, hopDepth, direction]
  );

  // The panel-driven impact overlay applies only while no canvas-internal
  // selection is active (a canvas click wins) and while the toolbar toggle is
  // on. Like a canvas click, it FOCUSES: the canvas prunes to the target plus
  // the files its change reaches, rather than showing the whole graph dimmed.
  const impactActive =
    !selected && overlayOn && impactHighlight ? impactHighlight : null;

  // The focus set + its root, from whichever source is driving: a canvas click
  // (file-graph N-hop neighborhood, hop/direction controlled) or the panel
  // (the target plus its computed blast — function-aware when a function is
  // drilled). Either way the canvas shows ONLY these files; nothing is dimmed.
  const focusRoot = selected ?? impactActive?.target ?? null;
  const focusSet = useMemo<Set<string> | null>(() => {
    if (focus) return focus.ids;
    if (impactActive)
      return new Set([impactActive.target, ...impactActive.impacted.keys()]);
    return null;
  }, [focus, impactActive]);

  // Files that survive the filters. When a focus is active the canvas prunes to
  // its set (the root always survives); otherwise it's the full graph minus the
  // hide-isolated / hide-tests / text filters.
  const visibleIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (n.path === focusRoot) {
        set.add(n.path); // the focused file is always shown
        continue;
      }
      if (focusSet && !focusSet.has(n.path)) continue;
      // hide-isolated is redundant inside a focus (neighborhood nodes are
      // connected by construction), so apply it only on the full graph.
      if (!focusSet && hideIsolated && n.inDegree === 0 && n.outDegree === 0)
        continue;
      if (hideTests && isTestFile(n.path)) continue;
      if (filter && !n.path.toLowerCase().includes(filter)) continue;
      set.add(n.path);
    }
    return set;
  }, [graph.nodes, hideIsolated, hideTests, filter, focusSet, focusRoot]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) => visibleIds.has(e.from) && visibleIds.has(e.to)
      ),
    [graph.edges, visibleIds]
  );

  // Re-layout whenever the visible set changes
  const positions = useMemo(() => {
    return layeredPositions([...visibleIds], visibleEdges);
  }, [visibleIds, visibleEdges]);

  // Refit after positions change
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      fitView({ padding: 0.08, duration: 300 })
    );
    return () => cancelAnimationFrame(id);
  }, [positions, fitView]);

  // How much of the highlight is actually on screen — the hide-tests / text
  // filters can still drop some impacted files from the pruned set, so the
  // toolbar count reports shown-vs-total instead of overstating.
  const impactShown = useMemo(() => {
    if (!impactHighlight) return { shown: 0, total: 0, targetHidden: false };
    let shown = 0;
    for (const p of impactHighlight.impacted.keys()) {
      if (visibleIds.has(p)) shown++;
    }
    return {
      shown,
      total: impactHighlight.impacted.size,
      targetHidden: !visibleIds.has(impactHighlight.target),
    };
  }, [impactHighlight, visibleIds]);

  // A fresh explorer pick (target changes) re-enables the overlay, so a toggle
  // the user left off doesn't silently swallow their next selection. Drilling
  // into a function keeps the same target file, so it won't fight the toggle.
  const highlightTarget = impactHighlight?.target ?? null;
  useEffect(() => {
    if (highlightTarget) setOverlayOn(true);
  }, [highlightTarget]);

  // Defensive: a graph prop swap (e.g. Refresh loads a newer snapshot) can
  // leave `selected` pointing at a file that no longer exists. Focus mode would
  // then prune to an empty set and blank the canvas until a pane click. Reset
  // the stale selection instead — mirrors the ImpactExplorer guard.
  useEffect(() => {
    if (selected && !graph.nodes.some((n) => n.path === selected)) {
      setSelected(null);
    }
  }, [graph, selected]);

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes
        .filter((n) => visibleIds.has(n.path))
        .map((n) => {
          const pos = positions.get(n.path) ?? { x: 0, y: 0 };
          // Both focus sources (canvas click and panel overlay) PRUNE the
          // canvas to the relevant subgraph, so nothing on screen is ever
          // dimmed — every visible node is relevant.
          const isDimmed = false;
          return {
            id: n.path,
            type: "file",
            position: { x: pos.x, y: pos.y },
            data: {
              path: n.path,
              ext: n.ext,
              inDegree: n.inDegree,
              outDegree: n.outDegree,
              isSelected:
                selected === n.path ||
                (!selected && impactActive?.target === n.path),
              isDimmed,
              isEntry: n.inDegree === 0,
              onSelect: setSelected,
            } as FileNodeData,
            draggable: true,
            selectable: false,
          };
        }),
    [graph.nodes, visibleIds, positions, selected, impactActive]
  );

  const edges: Edge[] = useMemo(
    () =>
      visibleEdges
        .filter((e) => enabledKinds[e.kind])
        .map((e) => {
          const isActive =
            !!selected && (e.from === selected || e.to === selected);
          const color = EDGE_COLOR[e.kind];
          return {
            id: `${e.kind}-${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
            type: "smoothstep",
            animated: isActive,
            style: {
              stroke: isActive ? color.stroke : color.strokeDim,
              strokeWidth: isActive ? 2 : 1,
              ...(color.dash ? { strokeDasharray: color.dash } : {}),
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isActive ? color.stroke : color.strokeDim,
              width: 12,
              height: 12,
            },
          };
        }),
    [visibleEdges, enabledKinds, selected]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of graph.edges) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [graph.edges]);

  const isolatedCount = useMemo(
    () =>
      graph.nodes.filter((n) => n.inDegree === 0 && n.outDegree === 0).length,
    [graph.nodes]
  );

  if (graph.nodes.length === 0) {
    if (graph.truncated) {
      return (
        <EmptyPanel
          icon={<AlertTriangle size={22} />}
          title="Dependency graph unavailable"
          body={graph.truncated}
        />
      );
    }
    return (
      <EmptyPanel
        icon={<Network size={22} />}
        title="No dependency data in this snapshot"
        hint={
          <>
            Click <strong style={{ color: TOK.textPrimary }}>Refresh</strong>{" "}
            in the topbar to rebuild the import graph.
          </>
        }
      />
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        width: "100%",
        height: 720,
        background: VIZ_SURFACE.bg,
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div
        className="absolute z-10 top-3 left-3 flex items-center gap-3 backdrop-blur rounded-lg px-3 py-2 text-xs shadow-lg max-w-[calc(100%-24px)] flex-wrap"
        style={{
          background: "rgba(10, 10, 12, 0.92)",
          color: TOK.textPrimary,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="filter path…"
          className="rounded px-2 py-0.5 text-xs outline-none w-40"
          style={{
            background: TOK.surfaceElevated,
            color: TOK.textPrimary,
            border: `1px solid ${TOK.border}`,
          }}
        />

        {selected && focus && (
          <div
            className="flex items-center gap-2 rounded-md px-2 py-1"
            style={{
              background: TOK.accentSoft,
              border: `1px solid ${TOK.accent}66`,
            }}
          >
            <Crosshair size={12} style={{ color: TOK.accent }} />
            <span
              className="font-mono text-[11px] max-w-[140px] truncate"
              style={{ color: TOK.accent }}
              title={selected}
            >
              {selected.split("/").pop()}
            </span>

            {/* hop stepper */}
            <span style={{ color: TOK.textMuted }}>·</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Fewer hops"
                onClick={() => setHopDepth((d) => Math.max(1, d - 1))}
                disabled={hopDepth <= 1}
                className="rounded p-0.5 disabled:opacity-30"
                style={{ border: `1px solid ${TOK.border}` }}
              >
                <Minus size={10} style={{ color: TOK.textSecondary }} />
              </button>
              <span
                className="tabular-nums text-[11px] w-10 text-center"
                style={{ color: TOK.textSecondary }}
                title="Hops out from the focused file"
              >
                {hopDepth} {hopDepth === 1 ? "hop" : "hops"}
              </span>
              <button
                type="button"
                aria-label="More hops"
                onClick={() => setHopDepth((d) => Math.min(3, d + 1))}
                disabled={hopDepth >= 3}
                className="rounded p-0.5 disabled:opacity-30"
                style={{ border: `1px solid ${TOK.border}` }}
              >
                <Plus size={10} style={{ color: TOK.textSecondary }} />
              </button>
            </div>

            {/* direction toggle */}
            <div className="flex items-center rounded overflow-hidden" style={{ border: `1px solid ${TOK.border}` }}>
              {(
                [
                  ["in", "who depends on this"],
                  ["out", "what this depends on"],
                  ["both", "both directions"],
                ] as [FocusDirection, string][]
              ).map(([d, label]) => (
                <button
                  key={d}
                  type="button"
                  title={label}
                  onClick={() => setDirection(d)}
                  className="px-1.5 py-0.5 text-[10px] transition"
                  style={{
                    background: direction === d ? TOK.accent : "transparent",
                    color: direction === d ? "#0a0a0c" : TOK.textSecondary,
                  }}
                >
                  {d}
                </button>
              ))}
            </div>

            {focus.dropped > 0 && (
              <span
                className="text-[10px]"
                style={{ color: TOK.amber }}
                title={`Neighborhood capped at ${FOCUS_CAP} nodes — ${focus.dropped} farther files hidden. Lower the hop depth or refine.`}
              >
                +{focus.dropped} hidden
              </span>
            )}

            <button
              type="button"
              aria-label="Clear focus"
              onClick={() => setSelected(null)}
              className="rounded p-0.5"
              style={{ border: `1px solid ${TOK.border}` }}
            >
              <X size={11} style={{ color: TOK.textSecondary }} />
            </button>
          </div>
        )}

        {isolatedCount > 0 && (
          <label
            className="flex items-center gap-1.5 cursor-pointer"
            title={`${isolatedCount} files have no imports in either direction`}
          >
            <input
              type="checkbox"
              checked={hideIsolated}
              onChange={(e) => setHideIsolated(e.target.checked)}
            />
            <span style={{ color: TOK.textSecondary }}>
              Hide isolated ({isolatedCount})
            </span>
          </label>
        )}

        {testCount > 0 && (
          <label
            className="flex items-center gap-1.5 cursor-pointer"
            title={`${testCount} test files — hidden by default because they dominate the fan-in of shared modules`}
          >
            <input
              type="checkbox"
              checked={hideTests}
              onChange={(e) => setHideTests(e.target.checked)}
            />
            <span style={{ color: TOK.textSecondary }}>
              Hide tests ({testCount})
            </span>
          </label>
        )}

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showMinimap}
            onChange={(e) => setShowMinimap(e.target.checked)}
          />
          <span style={{ color: TOK.textSecondary }}>Minimap</span>
        </label>

        {impactHighlight && (
          <label
            className="flex items-center gap-1.5 cursor-pointer"
            title={
              `Show only ${impactHighlight.target} plus the ${impactHighlight.impacted.size} file${impactHighlight.impacted.size === 1 ? "" : "s"} its change reaches — uncheck to see the full graph` +
              (impactShown.shown !== impactShown.total
                ? ` (${impactShown.total - impactShown.shown} hidden by hide-tests / filter)`
                : "")
            }
          >
            <input
              type="checkbox"
              checked={overlayOn}
              onChange={(e) => setOverlayOn(e.target.checked)}
            />
            <span style={{ color: overlayOn ? TOK.accent : TOK.textSecondary }}>
              Impact: {impactHighlight.target.split("/").pop()} →{" "}
              {impactShown.shown === impactShown.total
                ? impactShown.total
                : `${impactShown.shown} / ${impactShown.total}`}
            </span>
          </label>
        )}

        <div className="h-4 w-px" style={{ background: TOK.border }} />

        {(Object.keys(enabledKinds) as FileGraphEdgeKind[])
          .filter((k) => presentKinds.has(k))
          .map((k) => {
            const col = EDGE_COLOR[k].stroke;
            return (
              <label
                key={k}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={enabledKinds[k]}
                  onChange={(e) =>
                    setEnabledKinds((prev) => ({
                      ...prev,
                      [k]: e.target.checked,
                    }))
                  }
                />
                <span style={{ color: col }}>
                  {KIND_LABEL[k]} ({counts[k] ?? 0})
                </span>
              </label>
            );
          })}

        <div className="h-4 w-px" style={{ background: TOK.border }} />
        <span className="tabular-nums" style={{ color: TOK.textMuted }}>
          {focusRoot
            ? `${visibleIds.size} in focus`
            : `${visibleIds.size}/${graph.nodes.length} files`}
        </span>
      </div>

      <div
        className="absolute z-10 bottom-3 left-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] shadow-lg"
        style={{
          background: "rgba(10, 10, 12, 0.92)",
          color: TOK.textSecondary,
          border: `1px solid ${TOK.border}`,
        }}
      >
        {focusRoot
          ? "Click another file to re-focus · click empty space to see the full graph"
          : "Click a file to focus on its neighborhood · Arrow A → B means A uses B · Entry badge = nothing else points here"}
      </div>

      {graph.truncated && (
        <div
          className="absolute z-10 top-3 right-3 backdrop-blur rounded-lg px-3 py-2 text-[11px] border shadow-lg flex items-center gap-1.5"
          style={{
            background: "rgba(120, 70, 10, 0.85)",
            color: "rgba(253, 224, 171, 0.95)",
            borderColor: "rgba(253, 186, 116, 0.25)",
          }}
        >
          <AlertTriangle size={11} />
          {graph.truncated}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.08}
        maxZoom={2.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        onPaneClick={() => {
          setSelected(null);
          setOverlayOn(false); // also drop a panel-driven focus → full graph
        }}
      >
        <Background color={VIZ_SURFACE.grid} gap={28} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: "rgba(0,0,0,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(0,0,0,0.75)"
            nodeColor={(n) => {
              const d = n.data as FileNodeData;
              return (EXT_STYLE[d.ext] ?? FALLBACK).ring;
            }}
            style={{ background: "rgba(0,0,0,0.6)" }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export function DependencyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <DependencyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

void (null as unknown as FileGraphEdge);
