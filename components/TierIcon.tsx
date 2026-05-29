// Tier signature icons for RepoJury pricing (v0.82+ case rebrand).
//
// Tiers are case-flavoured now: Open case (free) / Standing docket
// (subscription) / Full bench (org). Icons reflect the metaphor:
//   - Open case       → FolderOpen — first folder pulled off the shelf
//   - Standing docket → ScrollText — the ongoing case list you live in
//   - Full bench      → Landmark   — the whole courthouse, every seat
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
//   <TierIcon tier="open-case" size={32} />
//   <TierIcon tier="full-bench" size={128} color={TOK.textMuted} />

import { FolderOpen, Landmark, ScrollText } from "lucide-react";
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
  "open-case": "Open case tier — try it free",
  "standing-docket": "Standing docket tier — repos you live in",
  "full-bench": "Full bench tier — for the whole org",
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
      return <FolderOpen {...commonProps} />;
    case "standing-docket":
      return <ScrollText {...commonProps} />;
    case "full-bench":
      return <Landmark {...commonProps} />;
  }
}
