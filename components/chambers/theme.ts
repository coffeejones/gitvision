// Chambers palette — the post-login app shell.
//
// Deliberately darker + cooler-neutral than the marketing TOK theme
// (and with NO warm orange): a clean, deep records-room dark. Emerald
// is the action/active accent (consistent with the product); brass is
// used only as a small brand tint on the crest.

export const CH = {
  // Surfaces — deep near-black, faint cool tint, layered up.
  bg: "#0A0A0D",
  sidebar: "#0D0D12",
  panel: "#121218",
  panelHover: "#16161D",
  elevated: "#1A1A22",

  // Lines
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",

  // Text
  text: "#ECECF1",
  textDim: "#9A9AA6",
  // Lifted from #62626C → #8A8A95 so metadata text (case numbers, score,
  // snapshot/filed counts, the private-repo sub-line) clears WCAG AA
  // 4.5:1 on the panel/elevated surfaces. The old value was ~3.09:1 —
  // legible-but-straining for sighted users, a fail for low-vision ones.
  textMuted: "#8A8A95",

  // Emerald action/active accent (matches the product green).
  accent: "#10b981",
  accentText: "#04130d",
  accentSoft: "rgba(16,185,129,0.13)",
  accentBorder: "rgba(16,185,129,0.34)",

  // Status (for case rows)
  critical: "#f87171",
  criticalSoft: "rgba(248,113,113,0.13)",
  warning: "#f59e0b",
  warningSoft: "rgba(245,158,11,0.13)",
  ok: "#4ade80",

  // Brass — brand tint, used sparingly (the crest only).
  brass: "#c9a227",
  brassLight: "#ecd488",
} as const;

/** Shared keyboard focus ring for interactive Chambers elements.
 *  There was no visible focus anywhere (WCAG 2.4.7 fail); this gives a
 *  consistent emerald ring on :focus-visible only (not on mouse click). */
export const CH_FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#10b981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0D]";
