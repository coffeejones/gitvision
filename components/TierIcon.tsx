// Tier signature icons for CodeTrawl pricing.
//
// Tiers are Free / Plus / Pro. Icons are a quiet nautical scale that
// nods to the trawl brand without crowding the now-plain tier names:
//   - Free → Anchor   — moored; a single one-off look
//   - Plus → Sailboat — out on the water; the repos you live in
//   - Pro  → Ship     — the whole vessel / fleet; for an org
//
// Why lucide instead of bespoke SVG: scaling-friendly vector,
// stroke-weight matches the rest of the UI automatically, and we
// dodge the "AI-generated icon" tell that DALL-E/coded-by-LLM outputs
// inevitably carry. When budget allows, this component can be swapped
// for a custom-designed family without touching any consumer code.
//
// Default colour is TOK.textPrimary (off-white) so the icons match
// the white-on-dark CTA system. Callers pass a different colour for
// severity contexts (rose for downgrade prompts, textMuted for
// inactive tiers, etc.).
//
// Usage:
//   <TierIcon tier="open-case" size={32} />
//   <TierIcon tier="full-bench" size={128} color={TOK.textMuted} />

import { Anchor, Sailboat, Ship } from "lucide-react";
import type { CSSProperties } from "react";

export type Tier = "open-case" | "standing-docket" | "full-bench";

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
  "open-case": "Free tier — try it free",
  "standing-docket": "Plus tier — repos you live in",
  "full-bench": "Pro tier — for the whole org",
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
    case "open-case":
      return <Anchor {...commonProps} />;
    case "standing-docket":
      return <Sailboat {...commonProps} />;
    case "full-bench":
      return <Ship {...commonProps} />;
  }
}
