// Shared palette for the data-viz surfaces — the canvas/graph node colours
// (Constellation, DependencyCanvas), contributor + UML-stereotype colours, the
// PR-flow sankey, and the hotspot treemap.
//
// CodeTrawl rations International Orange (#FF4F00) to genuine criticals and
// reads severity in TONE, not hue. So this file splits viz colour into two
// kinds, deliberately:
//
//  1. CATEGORY colours (language, author, PR-state, UML stereotype) — these
//     need to be distinguishable, so they use a DESATURATED, earthy palette
//     that sits calmly on the bitumen canvas and never reads as the alarm
//     orange. (Jonas approved this "muted categorical" direction over a pure
//     monochrome ramp, because the graphs are a flagship, screenshot-worthy
//     feature and 6-8 languages must stay legible.)
//
//  2. SEVERITY / DIVERSITY ramps (PR cycle-time, author diversity) — these
//     resolve to tone (light↔dark), with International Orange reserved for the
//     genuinely-bad end (a stale PR). Diversity is a positive signal, so it
//     just brightens — no orange.
//
// Centralised here so the language palette isn't duplicated across the two
// canvas components, and so adding a language never means editing colours in
// more than this one file.

export interface VizColor {
  bg: string;
  ring: string;
  text: string;
}

// Seven distinct muted hues — enough to tell 6-8 languages/authors apart on a
// dense graph without a rainbow. bg = dark desaturated tint of the hue (the
// node fill), ring = the muted mid-tone (border/label accent), text = a light
// tint (AA on both the node bg and the bitumen canvas).
export const MUTED = {
  blue: { bg: "#222f3d", ring: "#6e8ca8", text: "#aec2d6" },
  sage: { bg: "#2a3127", ring: "#899b79", text: "#c0ccb2" },
  clay: { bg: "#382a21", ring: "#b58463", text: "#d8b69b" },
  plum: { bg: "#302833", ring: "#9a8499", text: "#ccb8cb" },
  teal: { bg: "#22322f", ring: "#6f9692", text: "#a9cbc6" },
  sand: { bg: "#34301f", ring: "#b0a06a", text: "#d6c8a0" },
  rose: { bg: "#382727", ring: "#b07f82", text: "#d5b2b4" },
} as const satisfies Record<string, VizColor>;

// Stable ordered list for index-based assignment (e.g. per-author colours).
export const MUTED_LIST: VizColor[] = [
  MUTED.blue,
  MUTED.sage,
  MUTED.clay,
  MUTED.plum,
  MUTED.teal,
  MUTED.sand,
  MUTED.rose,
];

// Neutral fallback for unknown / overflow categories — warm grey, no hue.
export const VIZ_NEUTRAL: VizColor = {
  bg: "#232220",
  ring: "#8a8783",
  text: "#c9c4be",
};

// Canvas chrome (bitumen) + selection mark.
export const VIZ_SURFACE = {
  bg: "#0c0b0b", // canvas backdrop
  grid: "#1d1c1a", // ReactFlow background dots
  selected: "#eceae8", // selected-node ring — bone, neutral-bright
} as const;

// Author-diversity ramp for the hotspot treemap: few authors → many. More
// authors is a POSITIVE signal, so the tile brightens (dark bitumen → warm
// sand); no alarm orange. `text` is chosen for contrast on each fill.
export const DIVERSITY_RAMP: { fill: string; text: string }[] = [
  { fill: "#232220", text: "#c9c4be" }, // 9.8:1
  { fill: "#3a352b", text: "#eceae8" }, // 10.2:1
  // #6b5f3f is a mid-tone — near-black text was only 3.12:1 (fails AA); bone
  // text clears it (5.3:1). Only the lightest bucket below takes dark text.
  { fill: "#6b5f3f", text: "#eceae8" }, // 5.3:1
  { fill: "#b0a06a", text: "#0c0b0b" }, // 7.6:1
];

// PR cycle-time ramp: fast → slow. Fast is good (bone/neutral); slow is the
// genuine problem, so it warms through ember to International Orange. Tone +
// rationed orange, same logic as the rest of the surface.
export const CYCLE_TIME_RAMP = {
  fast: "#eceae8", // < 1 hour
  quick: "#b0aca8", // < 1 day
  steady: "#8a8783", // < 1 week
  slow: "#c2693a", // < 1 month — ember
  stale: "#ff4f00", // > 1 month — critical
} as const;
