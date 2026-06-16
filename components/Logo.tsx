// CodeTrawl logo — the orange swirl mark (public/icon, the brand's visual
// identity). Replaces the old "Baron" top-hat mascot.
//
// Single component, three usage modes:
//   <Logo size={20} />                   icon only
//   <Logo size={20} wordmark />          icon + "CodeTrawl" text
//   <Logo size={20} wordmark href="/" /> icon + text wrapped in a Link
//
// The mark is a fixed-colour PNG (International Orange on transparent), so the
// `color` prop no longer tints it — kept only for call-site compatibility.
// `textColor` still styles the wordmark. Source assets live in public/icon
// (favicon.ico + CodeTrawl-*.png at every size); the favicon/app-icon wiring
// is handled by the Next file conventions in app/ (favicon.ico, icon.png,
// apple-icon.png) rather than this component.

import Image from "next/image";
import Link from "next/link";
import { TOK } from "@/lib/theme";

interface Props {
  /** Pixel size of the icon. Default 24 — works for topbar; scale up
   *  for hero placements (32-48), down for inline mentions (16). */
  size?: number;
  /** Render the "CodeTrawl" wordmark next to the icon. */
  wordmark?: boolean;
  /** Wrap the whole thing in a Link to `href`. Useful for clickable
   *  brand-as-home-link in topbars. */
  href?: string;
  /** Deprecated: the mark is a fixed-colour PNG and no longer tints.
   *  Kept so existing call sites don't break. */
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
  textColor = TOK.textPrimary,
  className = "",
}: Props) {
  const inner = (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      style={{ lineHeight: 1 }}
    >
      <LogoMark size={size} />
      {wordmark && (
        <span
          className="font-semibold tracking-tight"
          style={{
            color: textColor,
            // Scale wordmark with icon — 0.85 ratio reads as
            // "icon-led" rather than "text-led".
            fontSize: Math.round(size * 0.85),
            letterSpacing: "-0.02em",
          }}
        >
          CodeTrawl
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center transition hover:opacity-80"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

/** Standalone mark for callers that want just the swirl (no wordmark /
 *  Link wrapper). The orange swirl PNG from public/icon, scaled to `size`. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <Image
      src="/icon/CodeTrawl-256x256.png"
      alt=""
      width={size}
      height={size}
      aria-hidden
      style={{ flexShrink: 0, display: "block" }}
    />
  );
}
