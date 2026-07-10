// Shared visual vocabulary for the /preview change-blast surface: the brand
// palette, the verdict traffic-light colors, the change-kind + tier labels, and
// path helpers. Lives in one place so the on-screen Result card (PreviewClient),
// the exportable BlastCard, and the BlastCardModal chrome all speak the same
// colors — /preview is the marketing surface (CTSurface), so it deliberately
// does NOT pull in the session `TOK` tokens.

import type { ChangeBlastReport, ChangedFileBlast } from "@/lib/changeBlast/types";

// International Orange is the one brand accent; the rest is bone-on-bitumen.
export const ORANGE = "#ff4f00";
export const EMBER = "#ff8a50";
export const BONE = "#eceae8";
export const MUTED = "rgba(255,255,255,0.58)";
export const SURFACE = "rgba(255,255,255,0.04)";
export const BORDER = "rgba(255,255,255,0.10)";
export const MINT = "#7fc7a1";
export const AMBER = "#d8b04a";

/** The reviewer's traffic light — a computed classification, never prose. */
export const VERDICT: Record<
  ChangeBlastReport["verdict"],
  { label: string; color: string }
> = {
  "high-risk": { label: "High risk", color: ORANGE },
  review: { label: "Review carefully", color: AMBER },
  clear: { label: "Clear", color: MINT },
};

export const KIND_LABEL: Record<ChangedFileBlast["kind"], string> = {
  added: "+ added",
  removed: "− removed",
  modified: "~ modified",
};

export const TIER_COLOR: Record<string, string> = {
  "load-bearing": ORANGE,
  "handle-with-care": AMBER,
  moderate: MUTED,
  safe: "rgba(255,255,255,0.4)",
};

/** Trailing path segment (the filename). */
export function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** Leading directory including the trailing slash ("" for a root-level file). */
export function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i + 1);
}

/** Compact number formatting for card stats (1.2k, 3.4M). */
export function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
