// The landing's palette in JS — and the rule for which palette a component uses.
//
// TWO PALETTES MEET ON THIS PAGE, ON PURPOSE.
//
//   CT  — the landing itself. Bitumen #0c0b0a, surface #161412. Mirrors the
//         custom properties on `.ct` in codetrawl.css.
//   TOK — the PRODUCT's surface (lib/sessionTheme, CH-backed). Canvas #0c0b0b,
//         panel #171615. Anything inside a window frame IS the product, so it
//         wears the product's colours, not the landing's.
//
// They are deliberately close and deliberately not identical, which is exactly
// why neither may be hand-copied. Three components had each transcribed their
// own TOK object, and the transcriptions had drifted from the product: #d29922
// where it uses CH.warning #c99a4e, an amber rule on the suggestion where it
// uses neutral bone, #cfcac3 where it uses CH.textDim. Every drift was a shade
// LOUDER than the real thing, which is how a shot stops looking like the app.
// Panes import TOK now — nothing to transcribe, nothing to drift.
//
// This file covers the other half: values the LANDING owns. They cannot be read
// as var() from an SVG presentation attribute, and AGENTS.md rules out Tailwind
// arbitrary values for critical colour, so they have to exist in JS somewhere.
// lib/__tests__/landingTokens.test.ts parses codetrawl.css and fails when one
// drifts from the custom property it mirrors.

export const CT = {
  bg: "#0c0b0a",
  surface: "#161412",
  line: "rgba(242, 239, 234, 0.09)",
  text: "#f2efea",
  dim: "#9c968e",
  faint: "#8a847c",
  ghost: "#66615b",
  orange: "#ff4f00",
  ember: "#ff8a50",
} as const;
