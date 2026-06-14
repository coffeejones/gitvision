"use client";

// CTClassDiagram — the showcase's interactive class-diagram mock, faithful to
// the real ClassCanvas (ReactFlow + Dagre): a top-down layered layout with
// ORTHOGONAL step edges (only vertical/horizontal segments, sharp corners —
// the clean look the real product ships), drag to pan, and click a class to
// trace its inheritance family (the clicked node + its neighbours stay lit,
// everything else dims). Hand-laid SVG, no ReactFlow on the landing, page
// monochrome ink — the selection "heat" is brightness, never orange.
//
// Classes, fields, methods and inheritance are the REAL flask values from the
// survey (verified against the session). The extractor sets no abstract/
// interface flags for Python, so every node renders «class» — exactly what
// the real canvas shows.

import { useRef, useState } from "react";

interface ClassNode {
  id: string;
  name: string;
  fields: string[];
  methods: string[];
  wide?: boolean; // long class name needs a wider card
}

const NODES: ClassNode[] = [
  // layer 0 — roots
  { id: "scaffold", name: "Scaffold", fields: ["cli: Group", "name: str"], methods: ["route()", "add_url_rule()"] },
  { id: "sessioniface", name: "SessionInterface", fields: ["null_session_class", "pickle_based"], methods: ["open_session()", "save_session()"] },
  { id: "sessionmixin", name: "SessionMixin", fields: ["new", "modified", "accessed"], methods: ["permanent()"] },
  // layer 1
  { id: "app", name: "App", fields: ["config_class", "jinja_environment"], methods: ["make_config()", "register_blueprint()"] },
  { id: "blueprint", name: "Blueprint", fields: ["_got_registered_once"], methods: ["register()", "record()"] },
  { id: "securecookieiface", name: "SecureCookieSessionInterface", wide: true, fields: ["salt", "digest_method"], methods: ["open_session()", "save_session()"] },
  { id: "securecookiesession", name: "SecureCookieSession", fields: ["modified"], methods: [] },
  // layer 2
  { id: "flask", name: "Flask", fields: ["session_interface: SessionInterface", "request_class: type"], methods: ["run()", "wsgi_app()"] },
];

// extends only (child → parent) — every edge connects adjacent layers, so the
// orthogonal routing never has to cross a node. All real flask inheritance.
const EDGES: { from: string; to: string }[] = [
  { from: "app", to: "scaffold" },
  { from: "blueprint", to: "scaffold" },
  { from: "flask", to: "app" },
  { from: "securecookieiface", to: "sessioniface" },
  { from: "securecookiesession", to: "sessionmixin" },
];

const CARD_W = 176;
const WIDE_W = 252;
const HGAP = 40;
const VGAP = 56;
const VB_W = 944;

const widthOf = (n: ClassNode) => (n.wide ? WIDE_W : CARD_W);
const heightOf = (n: ClassNode) => 61 + n.fields.length * 16 + n.methods.length * 16;

// adjacency for neighbour-highlight
const ADJ: Record<string, Set<string>> = {};
NODES.forEach((n) => (ADJ[n.id] = new Set()));
EDGES.forEach((e) => {
  ADJ[e.from].add(e.to);
  ADJ[e.to].add(e.from);
});

// longest extends-chain from a root = layer index
const PARENT: Record<string, string> = {};
EDGES.forEach((e) => (PARENT[e.from] = e.to));
function layerOf(id: string) {
  let l = 0;
  let cur = id;
  while (PARENT[cur]) {
    l++;
    cur = PARENT[cur];
  }
  return l;
}

// layered auto-layout: rows by layer, centred horizontally, layer Y stacked by
// the tallest card in each preceding layer.
type Box = { x: number; y: number; w: number; h: number; cx: number; top: number; bottom: number };
const POS: Record<string, Box> = {};
{
  const layers: ClassNode[][] = [];
  NODES.forEach((n) => {
    const l = layerOf(n.id);
    (layers[l] ||= []).push(n);
  });
  let y = 12;
  for (const row of layers) {
    if (!row) continue;
    const totalW = row.reduce((s, n) => s + widthOf(n), 0) + HGAP * (row.length - 1);
    let x = (VB_W - totalW) / 2;
    let maxH = 0;
    for (const n of row) {
      const w = widthOf(n);
      const h = heightOf(n);
      POS[n.id] = { x, y, w, h, cx: x + w / 2, top: y, bottom: y + h };
      x += w + HGAP;
      maxH = Math.max(maxH, h);
    }
    y += maxH + VGAP;
  }
}
const VB_H = Math.max(...NODES.map((n) => POS[n.id].bottom)) + 14;

// orthogonal step edge: child top → up to the mid-gap → across → up into the
// parent bottom. Only V/H segments, sharp corners.
function edgePath(e: { from: string; to: string }) {
  const c = POS[e.from];
  const p = POS[e.to];
  const ymid = (c.top + p.bottom) / 2;
  return `M ${c.cx} ${c.top} V ${ymid} H ${p.cx} V ${p.bottom}`;
}

function Node({ n, dim, sel }: { n: ClassNode; dim: boolean; sel: boolean }) {
  const b = POS[n.id];
  const sep1 = b.y + 45;
  const sep2 = b.y + 53 + n.fields.length * 16;
  return (
    <g
      data-node={n.id}
      className={`scd-node ${sel ? "scd-sel" : ""} ${dim ? "scd-dim" : ""}`}
      style={{ cursor: "pointer" }}
    >
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className="scd-card" />
      <text x={b.x + 12} y={b.y + 16} className="scd-tag">«class»</text>
      <text x={b.x + 12} y={b.y + 35} className="scd-name">{n.name}</text>
      <line x1={b.x} y1={sep1} x2={b.x + b.w} y2={sep1} className="scd-sep" />
      {n.fields.map((f, i) => {
        const [name, type] = f.split(": ");
        return (
          <text key={i} x={b.x + 12} y={b.y + 63 + i * 16} className="scd-member">
            + {name}
            {type ? <tspan className="scd-type">: {type}</tspan> : null}
          </text>
        );
      })}
      {n.methods.length > 0 ? (
        <>
          <line x1={b.x} y1={sep2} x2={b.x + b.w} y2={sep2} className="scd-sep" />
          {n.methods.map((m, i) => (
            <text key={i} x={b.x + 12} y={sep2 + 18 + i * 16} className="scd-member">+ {m}</text>
          ))}
        </>
      ) : null}
    </g>
  );
}

export function CTClassDiagram() {
  const [sel, setSel] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  // a single pointer gesture: capture only once it becomes a drag, so a plain
  // click still reaches node-selection (capturing on pointerdown stole it).
  const drag = useRef<{ px: number; py: number; ox: number; oy: number; nodeId: string | null; captured: boolean } | null>(null);
  const moved = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    const el = (e.target as Element).closest("[data-node]");
    drag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y, nodeId: el?.getAttribute("data-node") ?? null, captured: false };
    moved.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    const dc = drag.current;
    if (!dc) return;
    const dx = e.clientX - dc.px;
    const dy = e.clientY - dc.py;
    if (!moved.current && Math.abs(dx) + Math.abs(dy) > 5) {
      moved.current = true;
      dc.captured = true;
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch {}
    }
    if (moved.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      const scale = rect ? VB_W / rect.width : 1;
      setPan({ x: dc.ox + dx * scale, y: dc.oy + dy * scale });
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const dc = drag.current;
    drag.current = null;
    if (!dc) return;
    if (dc.captured) {
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch {}
    }
    if (!moved.current) {
      // a click: toggle the node under the pointer, or clear on empty canvas
      setSel((s) => (dc.nodeId ? (s === dc.nodeId ? null : dc.nodeId) : null));
    }
  }

  const highlight = sel ? new Set([sel, ...ADJ[sel]]) : null;

  return (
    <div className="scm scm-classd">
      <div className="scm-class-bar" aria-hidden>
        <span className="scm-class-search sc-quiet">Filter classes by name…</span>
        <span className="scm-class-toggle sc-quiet">▢ Hide unconnected</span>
        <span className="sc-quiet">8 of 53 shown</span>
      </div>
      <svg
        ref={svgRef}
        className="scm-classd-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Class diagram of flask: Scaffold is extended by App and Blueprint; App is extended by Flask; SessionInterface is extended by SecureCookieSessionInterface; SessionMixin is extended by SecureCookieSession. Drag to pan; click a class to highlight its inheritance family."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <marker id="scd-tri" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">
            <path d="M1 1 L10 5 L1 9 Z" className="scd-arrow-tri" />
          </marker>
          <pattern id="scd-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="scd-dot" />
          </pattern>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y})`}>
          <rect x={-700} y={-500} width={2400} height={1700} fill="url(#scd-dots)" />
          {EDGES.map((e, i) => {
            const active = sel != null && (e.from === sel || e.to === sel);
            const dim = sel != null && !active;
            return (
              <path
                key={i}
                d={edgePath(e)}
                markerEnd="url(#scd-tri)"
                className={`scd-edge ${active ? "scd-edge-on" : ""} ${dim ? "scd-edge-dim" : ""}`}
              />
            );
          })}
          {NODES.map((n) => (
            <Node key={n.id} n={n} sel={sel === n.id} dim={highlight != null && !highlight.has(n.id)} />
          ))}
        </g>
      </svg>
      <p className="scm-classd-hint sc-quiet">
        Drag to pan · click a class to trace its connections
      </p>
    </div>
  );
}
