// AnchorGlow — a rationed light-behind-frame for one element per page (Phase 2).
//
// On the landing, depth on the dark bitumen comes from LIGHT radiating from
// behind a frame, not a shadow (a dark shadow on a dark surface is invisible).
// This ports that one trick into the workspace, rationed hard: ONE glow per
// page, behind the single element that matters most — the HeadlineFinding, the
// worst security row, the Vulnerable tile. Light magnetizes the eye to the one
// thing, which is comprehension-by-attention, not decoration.
//
// Purely additive: a low-alpha radial sitting behind the child via a negative-
// inset absolute layer. No layout shift, no pointer capture, no dependency —
// if it renders as nothing, the child is unchanged.

import type { CSSProperties, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Glow hue. "bone" = neutral light (the default, matches the rationed-orange
   *  system where healthy/neutral never spends color); "warm" = a whisper of
   *  International Orange for a genuinely critical anchor. */
  tone?: "bone" | "warm";
  /** Radial strength. Kept low by default — this is a magnet, not a spotlight. */
  intensity?: number;
}

export function AnchorGlow({
  children,
  tone = "bone",
  intensity = 0.05,
}: Props) {
  const rgb = tone === "warm" ? "255, 79, 0" : "255, 255, 255";
  const glow: CSSProperties = {
    position: "absolute",
    inset: "-16% -8% -22% -8%",
    zIndex: 0,
    pointerEvents: "none",
    background: `radial-gradient(58% 68% at 50% 34%, rgba(${rgb}, ${intensity}), transparent 72%)`,
    filter: "blur(8px)",
  };
  return (
    <div className="relative">
      <div aria-hidden style={glow} />
      <div className="relative" style={{ zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
