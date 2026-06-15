// CH-backed re-theme alias for the deep per-session surface (/session/[id]).
//
// The session shell + all analysis views (components/views/*) were authored
// against the marketing "Linear-lighter" TOK palette (emerald accent, cool
// slate-violet surfaces in lib/theme.ts). To bring the whole post-login
// surface into the CodeTrawl "SURFACE & DEPTH" system without rewriting every
// inline style, we expose an object with the SAME property names TOK uses,
// each mapped to its CodeTrawl (Chambers / CH) equivalent. Swapping
// `import { TOK } from "@/lib/theme"` → `from "@/lib/sessionTheme"` re-skins a
// component in one line — the proven pattern from components/account/theme.ts.
//
// This keeps the session surface on the SAME palette as the /cases workspace,
// so the post-login app reads as one place. The old marketing landing ("/")
// still imports the real TOK, so it is untouched by this swap.
//
// SEMANTIC REMAP (not just a hue change): TOK's accent was emerald, doing
// double duty as both "brand action" AND "good / cleared / healthy". Under
// CodeTrawl, International Orange (#FF4F00) is RATIONED to genuine criticals,
// and severity reads in TONE, not colour. So:
//   accent  (brand + good)  → neutral bone   (active nav, links, a cleared seal)
//   amber   (warning)       → neutral dim    (conditional, mid severity)
//   rose    (bad / critical)→ International Orange (a returned verdict, a CVE)
// A healthy state therefore goes quiet/neutral and the one warm colour means
// "critical" everywhere on the surface.

import { CH } from "@/components/chambers/theme";

export const TOK = {
  // Surfaces
  bg: CH.bg,
  bgDeep: CH.bg,
  surface: CH.panel,
  surfaceElevated: CH.elevated,

  // Borders
  border: CH.border,
  borderStrong: CH.borderStrong,

  // Text
  textPrimary: CH.text,
  textSecondary: CH.textDim,
  textMuted: CH.textMuted,

  // Accent — was emerald; now neutral bone. Brand actions + the "good/cleared"
  // path read as brightness, never as a saturated colour.
  accent: CH.accent,
  accentOn: CH.accentText,
  accentSoft: CH.accentSoft,
  accentStrong: CH.accent,

  // Status — amber → neutral dim (warning/conditional reads in tone), rose →
  // International Orange (the one rationed heat: a genuine critical).
  amber: CH.warning,
  amberSoft: CH.warningSoft,
  rose: CH.critical,
  roseSoft: CH.criticalSoft,
} as const;

export type ThemeTokens = typeof TOK;

// STYLE is theme-agnostic typography (Tailwind className strings), so the
// session surface shares the single definition in lib/theme.ts.
export { STYLE } from "@/lib/theme";
