"use client";

// BlastRadiusDiagram — the concentric-ring "blast radius" hero (Phase 3).
//
// The Code tab is titled "Blast radius" but shipped two text lists. This makes
// the radius literal: the file sits at the center, each ring is one hop farther,
// what breaks if you change it ripples out to the LEFT (incoming), what it
// depends on to the RIGHT (outgoing). It's a gestalt read — a big gold cloud on
// the left means "this file is load-bearing" with zero decoding.
//
// Every dot is a REAL entry: hover it to see its file (+ hop, + cross-module),
// click it to open that file in the Source view. The ranked lists below stay,
// so the picture never hides the concrete "which files" — and they're the
// keyboard-accessible path (the dots are a mouse enhancement; each carries a
// <title> for the accessible name + native tooltip fallback).
//
// Dots are capped per hop for density (a hub file with 200 dependents mustn't
// become 200 dots); the per-hop count labels + the header totals carry the exact
// numbers, and the complete set lives in the lists below.

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import type { BlastRadius, BlastRadiusEntry } from "@/lib/codeAnalysis/blastRadius";
import { TOK } from "@/lib/sessionTheme";

const IN_COLOR = TOK.amber; // incoming — what breaks (caution gold)
const OUT_COLOR = TOK.accent; // outgoing — depends on (neutral bone)
const CAP_PER_HOP = 8;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

interface PlacedDot {
  entry: BlastRadiusEntry;
  x: number;
  y: number;
  side: "in" | "out";
}

function placeSide(
  cx: number,
  cy: number,
  rings: number[],
  entries: BlastRadiusEntry[],
  side: "in" | "out"
): PlacedDot[] {
  const [a1, a2] = side === "in" ? [206, 334] : [26, 154];
  const out: PlacedDot[] = [];
  for (let hop = 1; hop <= 3; hop++) {
    const r = rings[hop - 1];
    const es = entries.filter((e) => e.hop === hop).slice(0, CAP_PER_HOP);
    es.forEach((e, i) => {
      const t = es.length === 1 ? 0.5 : (i + 0.5) / es.length;
      const deg = a1 + t * (a2 - a1);
      const [x, y] = polar(cx, cy, r, deg);
      out.push({ entry: e, x, y, side });
    });
  }
  return out;
}

interface Props {
  blast: BlastRadius;
  /** The center (selected) file path. */
  file: string;
  size?: number;
}

export function BlastRadiusDiagram({ blast, file, size = 480 }: Props) {
  const router = useRouter();
  const params = useParams();
  const sessionId = String(params?.id ?? "");
  const [hover, setHover] = useState<BlastRadiusEntry | null>(null);

  const w = size;
  const h = size * 0.86;
  const cx = w / 2;
  const cy = h / 2;
  const rings = [size * 0.15, size * 0.245, size * 0.34];
  const dotR = size * 0.011;
  const centerR = size * 0.07;

  const inTotal = blast.incoming.length;
  const outTotal = blast.outgoing.length;
  const dots = [
    ...placeSide(cx, cy, rings, blast.outgoing, "out"),
    ...placeSide(cx, cy, rings, blast.incoming, "in"),
  ];
  const base = file.split("/").pop() ?? file;
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  function open(entry: BlastRadiusEntry) {
    router.push(
      `/session/${sessionId}/source?file=${encodeURIComponent(entry.filePath)}&line=1`
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: "100%", height: "auto" }}>
        {/* divider + hop rings */}
        <line x1={cx} y1={20} x2={cx} y2={h - 20} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        {rings.map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={TOK.border} strokeWidth={1} />
        ))}
        {rings.map((r, i) => (
          <text
            key={`hl-${i}`}
            x={cx}
            y={cy + r + 13}
            textAnchor="middle"
            style={{ fontSize: 10, fill: TOK.textMuted, letterSpacing: "0.04em" }}
          >
            {i + 1} hop{i === 0 ? "" : "s"}
          </text>
        ))}

        {/* per-hop counts on the upper diagonals */}
        {rings.map((r, i) => {
          const inC = blast.byHop.incoming[i + 1] ?? 0;
          const outC = blast.byHop.outgoing[i + 1] ?? 0;
          const [ix, iy] = polar(cx, cy, r, 318);
          const [ox, oy] = polar(cx, cy, r, 42);
          return (
            <g key={`hc-${i}`}>
              {inC > 0 && (
                <text x={ix - 5} y={iy - 3} textAnchor="end" style={{ fontSize: 10.5, fill: IN_COLOR, fontFamily: "var(--font-ct-mono, monospace)" }}>
                  {inC}
                </text>
              )}
              {outC > 0 && (
                <text x={ox + 5} y={oy - 3} textAnchor="start" style={{ fontSize: 10.5, fill: TOK.textSecondary, fontFamily: "var(--font-ct-mono, monospace)" }}>
                  {outC}
                </text>
              )}
            </g>
          );
        })}

        {/* dots — each a real entry: hover to name, click to open in Source */}
        {dots.map((d, i) => {
          const active = hover === d.entry;
          const col = d.side === "in" ? IN_COLOR : OUT_COLOR;
          return (
            <g
              key={i}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(d.entry)}
              onMouseLeave={() => setHover(null)}
              onClick={() => open(d.entry)}
            >
              {/* invisible larger hit target */}
              <circle cx={d.x} cy={d.y} r={dotR + 6} fill="transparent" />
              {d.entry.crossModule && (
                <circle cx={d.x} cy={d.y} r={dotR + 3.5} fill="none" stroke={TOK.rose} strokeWidth={1.25} />
              )}
              <circle cx={d.x} cy={d.y} r={active ? dotR * 1.7 : dotR} fill={col}>
                <title>{d.entry.filePath}</title>
              </circle>
            </g>
          );
        })}

        {/* center file node */}
        <circle cx={cx} cy={cy} r={centerR} fill={TOK.surface} stroke={TOK.textSecondary} strokeWidth={1} />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 10.5, fill: TOK.textPrimary, fontFamily: "var(--font-ct-mono, monospace)", fontWeight: 500 }}
        >
          {clip(base, 13)}
        </text>

        {/* headers */}
        <text x={16} y={26} style={{ fontSize: 11, fill: IN_COLOR, letterSpacing: "0.12em", fontWeight: 600 }}>INCOMING</text>
        <text x={16} y={43} style={{ fontSize: 11, fill: TOK.textSecondary }}>what breaks if this changes</text>
        <text x={16} y={74} style={{ fontSize: 28, fill: IN_COLOR, fontWeight: 600, letterSpacing: "-0.02em" }}>{inTotal}</text>
        <text x={w - 16} y={26} textAnchor="end" style={{ fontSize: 11, fill: TOK.textSecondary, letterSpacing: "0.12em", fontWeight: 600 }}>OUTGOING</text>
        <text x={w - 16} y={43} textAnchor="end" style={{ fontSize: 11, fill: TOK.textSecondary }}>what this depends on</text>
        <text x={w - 16} y={74} textAnchor="end" style={{ fontSize: 28, fill: OUT_COLOR, fontWeight: 600, letterSpacing: "-0.02em" }}>{outTotal}</text>
      </svg>

      {/* hover caption — stable height so the layout doesn't jump */}
      <div
        className="text-[11px] font-mono h-5 flex items-center gap-2 px-2 text-center"
        style={{ color: hover ? TOK.textSecondary : TOK.textMuted }}
        aria-live="polite"
      >
        {hover ? (
          <>
            <span style={{ color: hover.crossModule ? TOK.rose : TOK.textSecondary }}>{hover.filePath}</span>
            <span style={{ color: TOK.textMuted }}>
              · {hover.hop} hop{hover.hop === 1 ? "" : "s"}
              {hover.crossModule ? " · cross-module" : ""} · click to open
            </span>
          </>
        ) : (
          "Hover a node to see its file — click to open it in Source"
        )}
      </div>
    </div>
  );
}
