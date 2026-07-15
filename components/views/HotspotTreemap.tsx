"use client";

// Visual hotspot map: squarified treemap where size = churn and color = author diversity.
// No external charting lib — we use D3's treemap layout + plain SVG.

import { useMemo } from "react";
import * as d3 from "d3";
import type { FileHotspot } from "@/lib/types";
import { TOK } from "@/lib/sessionTheme";
import { DIVERSITY_RAMP } from "@/lib/vizPalette";

// Same ambiguous-basename list as the canvas — these appear all over
// monorepos with identical names, so we prefix the parent folder to
// disambiguate (packages/next/package.json → next/package.json).
const AMBIGUOUS_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "readme.md",
  "changelog.md",
  "license",
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.html",
  "index.md",
  "index.mjs",
  "cargo.toml",
  "go.mod",
  "__init__.py",
  "mod.rs",
  "lib.rs",
  "tsconfig.json",
  "tsconfig.build.json",
  "jest.config.js",
  "jest.config.ts",
  "webpack.config.js",
  ".gitignore",
  "dockerfile",
]);

function fileDisplayName(path: string): string {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  if (parts.length > 1 && AMBIGUOUS_BASENAMES.has(base.toLowerCase())) {
    return `${parts[parts.length - 2]}/${base}`;
  }
  return base;
}

// Author diversity → discrete, lightness-ordered levels (not a continuous
// gradient). Discrete so each level is easy to tell apart and the legend
// maps 1:1 to tiles; lightness-ordered (dark = few authors, bright = many)
// so the ramp is the redundant second channel — diversity stays legible
// without relying on hue (colour-blind safe) and even on tiles too small
// to fit a label. Buckets use absolute author counts, meaningful on any
// repo regardless of its max.
const DIVERSITY_BUCKETS: { label: string; test: (a: number) => boolean }[] = [
  { label: "1", test: (a) => a <= 1 },
  { label: "2–3", test: (a) => a <= 3 },
  { label: "4–6", test: (a) => a <= 6 },
  { label: "7+", test: () => true },
];

// Dark bitumen → warm sand (lib/vizPalette DIVERSITY_RAMP), stepping evenly in
// lightness. More authors is a positive signal, so the tile brightens rather
// than alarms — no rationed orange here. Each level carries the label colour
// that clears WCAG AA on its fill (light text on the dark levels, near-black on
// the light ones), so labels stay legible across the ramp with no outline.
const BUCKET_STYLE: { fill: string; text: string }[] = DIVERSITY_RAMP;

function bucketFor(authors: number): number {
  const i = DIVERSITY_BUCKETS.findIndex((b) => b.test(authors));
  return i === -1 ? DIVERSITY_BUCKETS.length - 1 : i;
}

// Height of the strip reserved at the top of each folder group for its label,
// so the grouping (by top-level folder) is legible instead of looking like
// arbitrary nested boxes.
const GROUP_HEADER = 17;

export function HotspotTreemap({
  hotspots,
  width = 800,
  height = 360,
  sessionId,
}: {
  hotspots: FileHotspot[];
  width?: number;
  height?: number;
  /** When set, each tile links into the Source view for that file. */
  sessionId?: string;
}) {
  const layout = useMemo(() => {
    if (hotspots.length === 0) return null;
    // Build a flat hierarchy — grouping by top-level folder keeps related files near each other.
    const groups = d3.group(hotspots, (h) => h.path.split("/")[0]);
    const root = {
      name: "root",
      children: [...groups.entries()].map(([folder, files]) => ({
        name: folder,
        children: files.map((f) => ({ name: f.path, value: f.churn, data: f })),
      })),
    };
    const hier = d3
      .hierarchy(root as unknown as d3.HierarchyNode<unknown>)
      .sum((d) => ((d as { value?: number }).value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    d3
      .treemap()
      .size([width, height])
      .paddingInner(2)
      .paddingOuter(3)
      // Reserve a header strip at the top of each folder group (depth 1) for
      // its label; the root (depth 0) keeps the normal 3px inset.
      .paddingTop((d) => (d.depth === 1 ? GROUP_HEADER : 3))
      .round(true)(hier as d3.HierarchyNode<unknown>);
    return hier as d3.HierarchyRectangularNode<unknown>;
  }, [hotspots, width, height]);

  if (!layout) {
    return (
      <div
        className="text-sm p-8 text-center rounded-xl border"
        style={{
          color: TOK.textMuted,
          background: TOK.surface,
          borderColor: TOK.border,
        }}
      >
        No commit-file data available. Try re-running on a more active repo.
      </div>
    );
  }

  const leaves = layout.leaves() as d3.HierarchyRectangularNode<{
    name: string;
    data: FileHotspot;
  }>[];

  return (
    <div
      className="rounded-xl p-5 overflow-hidden flex flex-col gap-3"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h3
        className="text-base font-semibold tracking-tight"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.01em",
        }}
      >
        Hotspots
      </h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
      >
        {leaves.map((node, i) => {
          const w = node.x1 - node.x0;
          const h = node.y1 - node.y0;
          const file = node.data as unknown as { name: string; data: FileHotspot };
          const style = BUCKET_STYLE[bucketFor(file.data.authors)];
          const displayName = fileDisplayName(file.data.path);
          // Max chars we can fit at ~7.5 px per mono char, leaving 10px padding
          const maxChars = Math.max(0, Math.floor((w - 10) / 7.5));
          const label =
            maxChars >= 3
              ? displayName.length > maxChars
                ? displayName.slice(0, maxChars - 1) + "…"
                : displayName
              : "";
          const href = sessionId
            ? `/session/${sessionId}/source?file=${encodeURIComponent(file.data.path)}`
            : null;
          const inner = (
            <>
              <title>{`${file.data.path}\nChurn: ${file.data.churn} commits\nAuthors: ${file.data.authors}\nScore: ${file.data.score.toFixed(2)}${href ? "\nClick to read the source" : ""}`}</title>
              <rect width={w} height={h} fill={style.fill} rx={3} />
              {/* Labels carry a per-tile text colour — light on the dark
                  levels, dark on the light ones — each verified ≥ 5.7:1, so
                  they stay legible across the ramp with no outline. Only
                  render if the tile is roomy enough to avoid the
                  "truncated-to-two-letters" look on tiny tiles. */}
              {w >= 50 && h >= 20 && label && (
                <text
                  x={5}
                  y={14}
                  fontSize={11}
                  fontFamily="var(--font-geist-mono)"
                  fill={style.text}
                  style={{ pointerEvents: "none" }}
                >
                  {label}
                </text>
              )}
              {w >= 70 && h >= 36 && (
                <text
                  x={5}
                  y={28}
                  fontSize={10}
                  fill={style.text}
                  fillOpacity={0.85}
                  style={{ pointerEvents: "none" }}
                >
                  {file.data.churn}× · {file.data.authors} auth
                </text>
              )}
            </>
          );
          return href ? (
            <a key={i} href={href} style={{ cursor: "pointer" }}>
              <g transform={`translate(${node.x0},${node.y0})`}>{inner}</g>
            </a>
          ) : (
            <g key={i} transform={`translate(${node.x0},${node.y0})`}>
              {inner}
            </g>
          );
        })}
        {/* Folder-group labels — small + muted, sitting in the header strip
            reserved at the top of each group so the grouping (by top-level
            folder) reads as a group, not arbitrary nested boxes. Skipped for
            narrow groups and single-file groups (the file label already names
            those). */}
        {layout.children?.map((group, gi) => {
          const gw = group.x1 - group.x0;
          const childCount = group.children?.length ?? 0;
          if (gw < 42 || childCount < 2) return null;
          const folder = (group.data as unknown as { name: string }).name;
          const maxChars = Math.max(1, Math.floor((gw - 8) / 6.2));
          const text =
            folder.length > maxChars
              ? folder.slice(0, Math.max(1, maxChars - 1)) + "…"
              : folder;
          return (
            <text
              key={`group-${gi}`}
              x={group.x0 + 4}
              y={group.y0 + 12}
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
              fill={TOK.textMuted}
              style={{ pointerEvents: "none", letterSpacing: "0.04em" }}
            >
              {text}
            </text>
          );
        })}
      </svg>
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs px-2 py-1"
        style={{ color: TOK.textMuted }}
      >
        <span>Size = churn · Color = unique authors</span>
        <div className="flex items-center gap-2.5">
          <span>authors</span>
          {DIVERSITY_BUCKETS.map((b, i) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block rounded-sm"
                style={{
                  width: 10,
                  height: 10,
                  background: BUCKET_STYLE[i].fill,
                  border: `1px solid ${TOK.border}`,
                }}
              />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
