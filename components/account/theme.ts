// CH-backed re-theme alias for the account panels.
//
// The account panels + primitives were authored against the marketing TOK
// palette. To bring Settings into the Chambers (workspace) theme without
// rewriting every markup line, we expose an object with the SAME property
// names TOK uses, but each mapped to its Chambers (CH) equivalent. Swapping
// `import { TOK } from "@/lib/theme"` → `import { TOK } from "./theme"` in a
// panel re-themes it to the cool records-room dark with a one-line change.
//
// Single source of truth for the TOK→CH mapping, so the panels stay
// consistent with the rest of the workspace.

import { CH } from "@/components/chambers/theme";

export const TOK = {
  // surfaces
  bg: CH.bg,
  bgDeep: CH.bg,
  surface: CH.panel,
  surfaceElevated: CH.elevated,
  // lines
  border: CH.border,
  borderStrong: CH.borderStrong,
  // text
  textPrimary: CH.text,
  textSecondary: CH.textDim,
  textMuted: CH.textMuted,
  // accent (emerald)
  accent: CH.accent,
  accentOn: CH.accentText,
  accentSoft: CH.accentSoft,
  accentStrong: CH.accent,
  // status
  amber: CH.warning,
  amberSoft: CH.warningSoft,
  rose: CH.critical,
  roseSoft: CH.criticalSoft,
} as const;
