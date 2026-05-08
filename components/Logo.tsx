// GitVision logo — concept A (Concentric blast radius) shipped as the
// brand's first visual identity (v0.75).
//
// Single component, three usage modes:
//   <Logo size={20} />                   icon only
//   <Logo size={20} wordmark />          icon + GitVision text
//   <Logo size={20} wordmark href="/" /> icon + text wrapped in a Link
//
// SVG uses currentColor for the rings + dot so callers can re-tint
// via the parent's `color` style. Default is TOK.accent (emerald).
//
// Why concentric rings: visually echoes blast-radius / impact-analysis
// — GitVision's signature feature. Three ring opacities produce a
// "ripple" feel without animation. Scales to favicon size cleanly
// because the geometry is purely round.
//
// Refinement-friendly: every dimension is parameterized off `size`,
// so changing the prop scales the whole mark proportionally. If you
// later refine in Figma and want to swap paths, only the SVG body
// inside <LogoMark /> needs editing.

import Link from "next/link";
import { TOK } from "@/lib/theme";

interface Props {
  /** Pixel size of the icon. Default 24 — works for topbar; scale up
   *  for hero placements (32-48), down for inline mentions (16). */
  size?: number;
  /** Render the "GitVision" wordmark next to the icon. */
  wordmark?: boolean;
  /** Wrap the whole thing in a Link to `href`. Useful for clickable
   *  brand-as-home-link in topbars. */
  href?: string;
  /** Override the icon color. Default uses TOK.accent (emerald). */
  color?: string;
  /** Override the wordmark text color. Default TOK.textPrimary. */
  textColor?: string;
  /** Class for outer container (use for spacing / alignment). */
  className?: string;
}

export function Logo({
  size = 24,
  wordmark = false,
  href,
  color = TOK.accent,
  textColor = TOK.textPrimary,
  className = "",
}: Props) {
  const inner = (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      style={{ color, lineHeight: 1 }}
    >
      <LogoMark size={size} />
      {wordmark && (
        <span
          className="font-semibold tracking-tight"
          style={{
            color: textColor,
            // Scale wordmark with icon — 0.95 ratio reads as
            // "icon-led" rather than "text-led" without looking
            // visually disconnected.
            fontSize: Math.round(size * 0.85),
            letterSpacing: "-0.02em",
          }}
        >
          GitVision
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center transition hover:opacity-80">
        {inner}
      </Link>
    );
  }
  return inner;
}

/** Standalone SVG for use cases that need raw markup (favicon
 *  generation, share cards, embed in Mermaid source comments).
 *  Exported so callers don't reach into the JSX wrapper. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      {/* Outer ring — most-faded ripple */}
      <circle
        cx="32"
        cy="32"
        r="26"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      {/* Middle ring */}
      <circle
        cx="32"
        cy="32"
        r="17"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.55"
      />
      {/* Inner ring */}
      <circle
        cx="32"
        cy="32"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.85"
      />
      {/* Centre dot — the "epicentre" */}
      <circle cx="32" cy="32" r="4" fill="currentColor" />
    </svg>
  );
}
