// Chambers palette — the post-login app shell.
//
// Re-skinned to the CodeTrawl "SURFACE & DEPTH" system (Stage 1): bitumen
// surfaces, bone text, hairlines. Every Chambers component reads these tokens
// inline, so this one file re-colours the whole workspace.
//
// Orange is RATIONED hard: International Orange (#FF4F00) is reserved for the
// single strongest signal — a genuine CRITICAL (a returned case, a critical
// department, a critical count). Everything else — active marks, links, tags,
// "new changes", and even "conditional/warning" — reads in TONE (brightness),
// not colour, so the workspace stays calm and the one alert colour means
// something. The accent + warning tokens are therefore neutral bone, not warm.

export const CH = {
  // Surfaces — bitumen, layered up.
  bg: "#0c0b0a",
  sidebar: "#0e0d0b",
  panel: "#161412",
  panelHover: "#1b1916",
  elevated: "#1f1c18",

  // Lines — hairlines (--ct-line)
  border: "rgba(242,239,234,0.09)",
  borderStrong: "rgba(242,239,234,0.14)",

  // Text — bone tones (--ct-text / dim / faint), all AA on the surfaces.
  text: "#f2efea",
  textDim: "#9c968e",
  textMuted: "#8a847c",

  // Accent — NEUTRAL bone, not orange. Active marks, links, tags and "new
  // changes" read as brightness, not a warm wash. (The one inverted button
  // that uses accent-as-background gets bone bg + near-black text.)
  accent: "#f2efea",
  accentText: "#150700",
  accentSoft: "rgba(242,239,234,0.10)",
  accentBorder: "rgba(242,239,234,0.20)",

  // Status (case rows) — ONLY a genuine critical glows orange. Conditional/
  // warning is neutral dim, cleared/ok is quiet faint: severity by tone.
  critical: "#ff4f00",
  criticalSoft: "rgba(255,79,0,0.12)",
  warning: "#9c968e",
  warningSoft: "rgba(242,239,234,0.07)",
  ok: "#8a847c",

  // Brass — retired with the courtroom crest; kept as neutral aliases so any
  // stray importer doesn't break. Not used in the CodeTrawl chrome.
  brass: "#9c968e",
  brassLight: "#f2efea",
} as const;

/** Shared keyboard focus ring for interactive Chambers elements — ember, the
 *  CodeTrawl focus colour (never new orange), on :focus-visible only. */
export const CH_FOCUS =
  "outline-none focus-visible:ring-1 focus-visible:ring-[#ff8a50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0b0a]";
