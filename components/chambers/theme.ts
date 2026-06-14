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
  // Surfaces — a dim "warm grey" (greige): roughly half the warmth of the
  // landing's bitumen, so the screen isn't a warm/orange wash, but it isn't
  // cool/blue-grey either. The middle ground. Only the accents carry heat.
  bg: "#0c0b0b",
  sidebar: "#0e0d0c",
  panel: "#171615",
  panelHover: "#1d1c1a",
  elevated: "#232220",

  // Lines — near-neutral white hairlines.
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.13)",

  // Text — warm-grey light/grey, all AA on the surfaces.
  text: "#eceae8",
  textDim: "#9b9794",
  textMuted: "#8a8783",

  // Accent — NEUTRAL light, not orange. Active marks, links, tags and "new
  // changes" read as brightness. (The one inverted button that uses accent as
  // a background gets a light bg + near-black text.)
  accent: "#eceae8",
  accentText: "#0c0b0b",
  accentSoft: "rgba(255,255,255,0.10)",
  accentBorder: "rgba(255,255,255,0.20)",

  // Status (case rows) — ONLY a genuine critical glows orange (the brand
  // heat). Conditional/warning is neutral dim, cleared/ok is quiet faint:
  // severity by tone, warmth reserved for criticals.
  critical: "#ff4f00",
  criticalSoft: "rgba(255,79,0,0.13)",
  warning: "#9b9794",
  warningSoft: "rgba(255,255,255,0.07)",
  ok: "#8a8783",

  // Brass — retired with the courtroom crest; kept as neutral aliases so any
  // stray importer doesn't break. Not used in the CodeTrawl chrome.
  brass: "#9b9794",
  brassLight: "#eceae8",
} as const;

/** Shared keyboard focus ring for interactive Chambers elements — ember, the
 *  CodeTrawl focus colour (never new orange), on :focus-visible only. */
export const CH_FOCUS =
  "outline-none focus-visible:ring-1 focus-visible:ring-[#ff8a50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0b0b]";
