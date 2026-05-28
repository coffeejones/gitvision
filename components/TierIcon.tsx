// Tier signature icons for RepoJury pricing — Scout (Free), Knight
// (Plus), Baron (Pro). Uses lucide-react (Shield / Swords / Crown) so
// the icons inherit production-grade vector quality and stay visually
// consistent with the rest of the app's iconography (Sparkles,
// Activity, Network, etc. are all from the same library).
//
// Why lucide instead of bespoke SVG: scaling-friendly vector,
// stroke-weight matches the rest of the UI automatically, and we
// dodge the "AI-generated icon" tell that DALL-E/coded-by-LLM outputs
// inevitably carry. When budget allows, this component can be swapped
// for a custom-designed family without touching any consumer code.
//
// Default colour is TOK.textPrimary (off-white) so the icons match
// the white-on-dark CTA system established in D4 Pass 1–10. Callers
// pass a different colour for severity contexts (rose for downgrade
// prompts, textMuted for inactive tiers, etc.).
//
// Usage:
//   <TierIcon tier="scout" size={32} />
//   <TierIcon tier="baron" size={128} color={TOK.textMuted} />

import { Crown, Shield, Swords } from "lucide-react";
import type { CSSProperties } from "react";

export type Tier = "scout" | "knight" | "baron";

interface Props {
  tier: Tier;
  /** Pixel size (square). Defaults to 32, the standard in-app badge size. */
  size?: number;
  /** Override the off-white default. Useful for dimmed / inactive states. */
  color?: string;
  /** Lucide's stroke-width prop. 1.5 is the default for lucide-react. */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

const TIER_LABELS: Record<Tier, string> = {
  scout: "Scout tier — exploration",
  knight: "Knight tier — capable",
  baron: "Baron tier — mastered",
};

export function TierIcon({
  tier,
  size = 32,
  color = "#E8E8EE",
  strokeWidth = 1.5,
  className,
  style,
}: Props) {
  const commonProps = {
    size,
    color,
    strokeWidth,
    className,
    style,
    "aria-label": TIER_LABELS[tier],
  } as const;

  switch (tier) {
    case "scout":
      return <Shield {...commonProps} />;
    case "knight":
      return <Swords {...commonProps} />;
    case "baron":
      return <Crown {...commonProps} />;
  }
}
