// Class-canvas data transformation (v0.72 / Architecture Phase 2).
//
// Pure function: ClassDef[] → { nodes, edges, dimensions } ready for
// ReactFlow. Layout is Dagre top-to-bottom — class diagrams are
// fundamentally hierarchical (extends/implements arrows go DOWN, DI
// associations go horizontally), so Sugiyama-style layered layout
// produces the most readable result for our 6-30 class typical case.
//
// Why a separate file from classDiagram.ts: that one emits Mermaid
// SOURCE (for shareability — paste in README / mermaid.live). This
// one builds the in-app interactive view (for browsing). Different
// consumers, different optimal data shapes, no shared rendering.
// The two stay in sync because they read the same CodeGraph.classes
// array — there's no parallel source-of-truth to drift apart.

import dagre from "@dagrejs/dagre";
import type { ClassDef, CodeGraph, ParsedField } from "../codeAnalysis/types";

/** What a single ClassNode in the canvas needs at render time. The
 *  custom node component reads this directly from `node.data`.
 *
 *  ReactFlow v12's Node generic requires data to extend
 *  Record<string, unknown> — extending it is the documented escape
 *  hatch when you want strongly-typed fields PLUS that constraint.
 *  The component-side AugmentedClassNodeData adds transient
 *  selection-state fields on top. */
export interface ClassNodeData extends Record<string, unknown> {
  label: string;
  filePath: string;
  fields: ParsedField[];
  /** Method names rendered as `+name()` in the body. Visibility is
   *  always "+" because FunctionDef doesn't carry per-method modifier
   *  info yet — same compromise as the Mermaid renderer. */
  methodNames: string[];
  isInterface: boolean;
  isAbstract: boolean;
  isEnum: boolean;
  enumValues: string[];
}

export interface ClassEdgeData extends Record<string, unknown> {
  /** UML semantics: extends arrow (filled triangle, solid line),
   *  implements (filled triangle, dashed line), or association
   *  (open arrow, solid line, with field-name label). */
  kind: "extends" | "implements" | "association";
  /** Field name driving an association edge. Only set when
   *  kind === "association". */
  fieldName?: string;
}

export type ClassCanvasNode = {
  id: string;
  position: { x: number; y: number };
  data: ClassNodeData;
  /** ReactFlow custom node type discriminator — matches the key
   *  registered in <ReactFlow nodeTypes={...}>. */
  type: "class";
  /** Dagre-computed dimensions. ReactFlow needs width/height when we
   *  set positions manually so its viewport calculations work. */
  width: number;
  height: number;
};

export type ClassCanvasEdge = {
  id: string;
  source: string;
  target: string;
  data: ClassEdgeData;
  type: "class";
};

export interface ClassCanvasResult {
  nodes: ClassCanvasNode[];
  edges: ClassCanvasEdge[];
  /** Total class count rendered. Drives "showing N of M" UI hints. */
  classCount: number;
  /** Total classes available before any cap. */
  totalAvailable: number;
}

export interface ClassCanvasOptions {
  /** Cap on classes rendered. Mermaid breaks past a few hundred;
   *  ReactFlow handles more but at some point the diagram stops
   *  being legible regardless. Same default as the Mermaid path. */
  maxClasses?: number;
  /** Optional folder scope to filter the source classes (matches
   *  ClassDiagramScope from classDiagram.ts). */
  scope?:
    | { kind: "all" }
    | { kind: "file"; filePath: string }
    | { kind: "folder"; folder: string };
}

const DEFAULT_MAX_CLASSES = 250;

// Dimensions for layout planning. The custom node component should
// honour these — Dagre uses them to compute non-overlapping positions.
// Picked to fit a typical entity class (5-7 fields, 2-4 methods)
// without scrolling. Real per-node height could vary; we accept some
// vertical space on small classes in exchange for a much simpler
// layout pass.
export const NODE_WIDTH = 240;
export const NODE_HEIGHT_BASE = 60; // header + padding
export const NODE_HEIGHT_PER_ROW = 16; // fields + methods rows

/** Estimate a node's height from its content row count. Dagre uses
 *  this for vertical spacing — too small and rows get clipped, too
 *  large and the diagram has wasted whitespace. */
function estimateNodeHeight(cls: ClassDef): number {
  const fieldRows = cls.isEnum ? cls.enumValues?.length ?? 0 : cls.fields.length;
  const methodRows = cls.isEnum ? 0 : cls.methods.length;
  const stereotypeRow = cls.isInterface || cls.isAbstract || cls.isEnum ? 1 : 0;
  return (
    NODE_HEIGHT_BASE +
    (fieldRows + methodRows + stereotypeRow) * NODE_HEIGHT_PER_ROW
  );
}

/** Build the ReactFlow data + run Dagre layout in one pass. Pure
 *  function — no DOM, no I/O. Caller plugs the result into a
 *  <ReactFlow nodes={...} edges={...} /> instance. */
export function buildClassCanvas(
  cg: CodeGraph,
  opts: ClassCanvasOptions = {}
): ClassCanvasResult {
  const allClasses = cg.classes ?? [];
  const totalAvailable = allClasses.length;
  const maxClasses = opts.maxClasses ?? DEFAULT_MAX_CLASSES;
  const scoped = filterByScope(allClasses, opts.scope ?? { kind: "all" });
  const capped = scoped.slice(0, maxClasses);

  // Defensive name-dedup. The aggregator's pass-2 (codeGraph.ts) already
  // ensures unique class names for snapshots built v0.77+. But snapshots
  // saved BEFORE v0.77 may still contain colliding `Foo_basename` names
  // (two `tests/test_views.py` files in different directories both
  // produced `Index_test_views`). Without this dedup, ReactFlow gets
  // duplicate node + edge IDs and silently drops some entities while
  // logging a React-key warning. Rename collisions in-place so legacy
  // snapshots render cleanly until the user clicks Refresh.
  const seenName = new Map<string, number>();
  const trimmed = capped.map((cls) => {
    const count = (seenName.get(cls.name) ?? 0) + 1;
    seenName.set(cls.name, count);
    if (count === 1) return cls;
    // Mirrors the aggregator's pass-2 numbering scheme so legacy
    // snapshots get the same shape they would after a Refresh.
    return { ...cls, name: `${cls.name}_${count}` };
  });

  if (trimmed.length === 0) {
    return { nodes: [], edges: [], classCount: 0, totalAvailable };
  }

  const renderedNames = new Set(trimmed.map((c) => c.name));

  // Edges drive the layout: extends/implements pull child below
  // parent, associations pull related classes near each other. Order
  // matters mostly for ties — extends first means inheritance lines
  // dominate the layout when both kinds touch the same node.
  const edges: ClassCanvasEdge[] = [];
  const seenAssoc = new Set<string>();

  for (const cls of trimmed) {
    if (cls.parentClass && renderedNames.has(cls.parentClass)) {
      edges.push({
        id: `extends:${cls.parentClass}->${cls.name}`,
        source: cls.parentClass,
        target: cls.name,
        data: { kind: "extends" },
        type: "class",
      });
    }
    for (const iface of cls.implements ?? []) {
      if (!renderedNames.has(iface)) continue;
      edges.push({
        id: `implements:${iface}->${cls.name}`,
        source: iface,
        target: cls.name,
        data: { kind: "implements" },
        type: "class",
      });
    }
    // Field-based association: same logic as classDiagram.ts —
    // peel generic / pointer / nullable wrappers to find an inner
    // rendered class.
    for (const field of cls.fields) {
      if (!field.type) continue;
      const target = resolveArrowTarget(field.type, renderedNames);
      if (!target || target === cls.name) continue;
      const key = `${cls.name}->${target}`;
      if (seenAssoc.has(key)) continue;
      seenAssoc.add(key);
      edges.push({
        id: `assoc:${cls.name}->${target}:${field.name}`,
        source: cls.name,
        target,
        data: { kind: "association", fieldName: field.name },
        type: "class",
      });
    }
  }

  // Compute initial Dagre positions for the FULL trimmed set. The
  // canvas re-runs layout client-side when filters change so the
  // visible classes always pack tightly — but for the initial
  // render and for unfiltered views, this saves a render cycle.
  const positions = layoutDagre(
    trimmed.map((cls) => ({
      id: cls.name,
      width: NODE_WIDTH,
      height: estimateNodeHeight(cls),
    })),
    edges
  );

  // Assemble final ReactFlow nodes. Dagre positions a node by its
  // CENTER; ReactFlow positions by top-left, so we offset by half
  // the dimensions inside layoutDagre — the Map already returns
  // top-left coordinates.
  const nodes: ClassCanvasNode[] = trimmed.map((cls) => {
    const height = estimateNodeHeight(cls);
    const pos = positions.get(cls.name) ?? { x: 0, y: 0 };
    return {
      id: cls.name,
      position: pos,
      width: NODE_WIDTH,
      height,
      data: {
        label: cls.name,
        filePath: cls.filePath,
        fields: cls.fields,
        // v0.77: dedupe method names. Multiple function_definitions
        // can share a name in the same class (Python @overload typing
        // stubs, @property+@setter pairs, Java overloads). Showing
        // each one as a separate `+foo()` row makes the canvas look
        // buggy. cls.methods stays intact for blast-radius / complexity
        // consumers; we just collapse for display.
        methodNames: dedupeStrings(cls.methods.map((m) => m.name)),
        isInterface: cls.isInterface ?? false,
        isAbstract: cls.isAbstract ?? false,
        isEnum: cls.isEnum ?? false,
        enumValues: cls.enumValues ?? [],
      },
      type: "class",
    };
  });

  return {
    nodes,
    edges,
    classCount: trimmed.length,
    totalAvailable,
  };
}

/** Run Dagre layout on a set of (id, width, height) nodes + edges.
 *  Returns a Map of id → top-left position (already offset from
 *  Dagre's center-based output).
 *
 *  Exported because the canvas component re-runs layout client-side
 *  when filters change — `buildClassCanvas` produces the initial
 *  full-set layout, but a "Hide unconnected" or search filter
 *  shrinks the visible set and we need positions that pack the
 *  REMAINING nodes tightly. Without re-running, the canvas keeps
 *  positions from the unfiltered layout and shows the same wide
 *  scattering with most boxes hidden. */
export function layoutDagre(
  nodes: { id: string; width: number; height: number }[],
  edges: { source: string; target: string }[]
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 60,
    ranksep: 90,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  // Only emit edges where both endpoints are in the nodes set.
  // Dagre tolerates phantom edges but renders them with zero-size
  // nodes, which warps the layout.
  const known = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const dn = g.node(n.id);
    if (!dn) continue;
    out.set(n.id, {
      x: dn.x - n.width / 2,
      y: dn.y - n.height / 2,
    });
  }
  return out;
}

// ---------------- Internals (mirrored from classDiagram.ts) ----------------

function filterByScope(
  classes: ClassDef[],
  scope: NonNullable<ClassCanvasOptions["scope"]>
): ClassDef[] {
  switch (scope.kind) {
    case "all":
      return classes;
    case "file":
      return classes.filter((c) => c.filePath === scope.filePath);
    case "folder": {
      const folder = scope.folder.replace(/\/$/, "");
      return classes.filter(
        (c) => c.filePath === folder || c.filePath.startsWith(`${folder}/`)
      );
    }
  }
}

/** Same logic as classDiagram.resolveArrowTarget — peels generic /
 *  pointer / slice / nullable / map wrappers to find an inner
 *  rendered class. Kept inline here so the canvas module is
 *  self-contained (no cross-import that ties two unrelated render
 *  paths together). */
function resolveArrowTarget(
  type: string,
  rendered: Set<string>
): string | undefined {
  if (rendered.has(type)) return type;
  if (type.endsWith("?")) {
    const inner = type.slice(0, -1).trim();
    if (rendered.has(inner)) return inner;
  }
  const angleMatch = type.match(/^[A-Za-z_][A-Za-z0-9_.]*<(.+)>$/);
  if (angleMatch) {
    for (const candidate of splitTopLevel(angleMatch[1])) {
      const t = resolveArrowTarget(candidate.trim(), rendered);
      if (t) return t;
    }
  }
  const bracketMatch = type.match(/^[A-Za-z_][A-Za-z0-9_.]*\[(.+)\]$/);
  if (bracketMatch) {
    for (const candidate of splitTopLevel(bracketMatch[1])) {
      const t = resolveArrowTarget(candidate.trim(), rendered);
      if (t) return t;
    }
  }
  if (type.startsWith("[]")) {
    return resolveArrowTarget(type.slice(2).trim(), rendered);
  }
  if (type.startsWith("*")) {
    return resolveArrowTarget(type.slice(1).trim(), rendered);
  }
  const mapMatch = type.match(/^map\[(.+)\](.+)$/);
  if (mapMatch) {
    return resolveArrowTarget(mapMatch[2].trim(), rendered);
  }
  return undefined;
}

/** v0.77: dedupe a string array preserving first-occurrence order.
 *  Used for method-name collapse in ClassNodeData.methodNames so the
 *  canvas doesn't render `+permanent()` twice when a Python class
 *  has both `@property` and `@x.setter` definitions of `permanent`. */
function dedupeStrings(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of input) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "[") depth++;
    else if (c === ">" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}
