// CTScreenshot — mounts a real product screenshot the way Raycast/Linear do:
// a window frame (chrome bar + hairline + radius) floating on a lighter tonal
// "stage" with a warm light-source at the top. On a dark page depth reads from
// LIGHT (the lighter stage + a lit top edge), not from a shadow you can't see.
//
// Usage:  <CTScreenshot src="/x.png" alt="…" label="codetrawl.com — faultline" />
//         <CTScreenshot src="/x.png" alt="…" flat />   // hairline only, no stage
//
// Styling is inline on purpose — critical colors/gradients here must not depend
// on Tailwind class timing (see AGENTS.md gotchas). Fonts come from the .ct
// scope (CTSurface), so this must render inside <CTSurface>.

import type { CSSProperties, ReactNode } from "react";

// The FRAME is the landing's, not the product's — it is the device around the
// screenshot, so it wears the page's palette while everything mounted inside it
// wears the product's (see ./tokens). This used to be a fourth hand-copied
// palette, with a #0d0b0a that matched no token at all.
import { CT as TOK } from "./tokens";

// No panel: a transparent wrapper that just gives the glow room to bleed into
// the page. There is no rectangle, no border — only the frame and the light.
const stage: CSSProperties = {
  position: "relative",
  padding: "clamp(30px, 6vw, 96px) clamp(16px, 4vw, 60px) clamp(30px, 6vw, 96px)",
};

// The light itself — a warm bloom that radiates from behind the frame and fades
// straight into the bitumen background (no container edges clip it).
const bloom: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(1240px, 116%)",
  height: "132%",
  background: `radial-gradient(ellipse 56% 52% at 50% 32%, color-mix(in srgb, ${TOK.orange} 17%, transparent), transparent 60%), radial-gradient(ellipse 76% 66% at 50% 42%, rgba(242, 239, 234, 0.06), transparent 68%)`,
  filter: "blur(46px)",
  pointerEvents: "none",
  zIndex: 0,
};

const frameBase: CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxWidth: 980,
  margin: "0 auto",
  borderRadius: 14,
  overflow: "hidden",
  background: TOK.surface,
};

const frameDepth: CSSProperties = {
  border: "1px solid rgba(242, 239, 234, 0.10)",
  boxShadow:
    "inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 1px 1px rgba(0,0,0,0.5), 0 30px 60px -24px rgba(0,0,0,0.9), 0 60px 120px -40px rgba(0,0,0,0.8)",
};

const frameFlat: CSSProperties = { border: `1px solid ${TOK.line}` };

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  height: 40,
  padding: "0 14px",
  background: `color-mix(in srgb, ${TOK.surface} 62%, #000)`,
  borderBottom: `1px solid ${TOK.line}`,
};

const dot: CSSProperties = {
  width: 11,
  height: 11,
  borderRadius: "50%",
  background: "rgba(242, 239, 234, 0.16)",
};

const url: CSSProperties = {
  fontFamily: "var(--ct-mono)",
  fontSize: 12,
  color: TOK.faint,
  margin: "0 auto",
};

const caption: CSSProperties = {
  maxWidth: 980,
  margin: "20px auto 0",
  fontFamily: "var(--ct-mono)",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: TOK.faint,
  textAlign: "center",
};

export function CTScreenshot({
  src,
  alt,
  children,
  label,
  caption: cap,
  flat = false,
  tight = false,
  bleed,
  fade,
  wide = false,
  width,
  height,
  priority = false,
}: {
  /** Omit when passing `children` — the frame then wraps live content. */
  src?: string;
  alt?: string;
  /** Render real markup inside the window instead of an image. Used by the
   *  code pane, so a rendered view and a screenshot sit in the SAME frame and
   *  the page cannot tell you which is which by its chrome. */
  children?: ReactNode;
  /** the window-bar URL, e.g. "codetrawl.com — faultline". Omit to leave it blank. */
  label?: string;
  /** optional mono line under the frame */
  caption?: ReactNode;
  /** hairline only, no lighter stage or shadow (the strict editorial look) */
  flat?: boolean;
  /** less glow padding — for use inside a column rather than full-width */
  tight?: boolean;
  /** fill the container and run flush to the viewport edge on this side (the
   *  frame squares off on that edge — as if the app continues off-screen).
   *  The parent column must reach that viewport edge. */
  bleed?: "left" | "right";
  /** dissolve the outer edge of the frame into the page (only the outer ~16%,
   *  so central content is untouched). Pairs with the opposite-side bleed:
   *  bleed="left" + fade="right", or bleed="right" + fade="left". */
  fade?: "left" | "right";
  /** let the frame fill its container instead of capping at 980px — for a big
   *  full-width establishing shot (e.g. the hero). */
  wide?: boolean;
  /** intrinsic image dimensions — reserves layout space so the page never
   *  shifts while screenshots load (CLS). */
  width?: number;
  height?: number;
  /** above-the-fold shot: eager + high fetch priority; everything else lazy. */
  priority?: boolean;
}) {
  const basePad = tight
    ? { y: "clamp(16px, 3vw, 44px)", x: "clamp(10px, 2vw, 30px)" }
    : { y: "clamp(30px, 6vw, 96px)", x: "clamp(16px, 4vw, 60px)" };
  const stageStyle: CSSProperties = {
    ...stage,
    padding: `${basePad.y} ${bleed === "right" ? "0" : basePad.x} ${basePad.y} ${bleed === "left" ? "0" : basePad.x}`,
  };
  const frameShape: CSSProperties = bleed
    ? {
        maxWidth: "none",
        margin: 0,
        ...(bleed === "left"
          ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "0" }
          : { borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "0" }),
      }
    : {};
  // Dissolve the outer edge into the page. Drop the big drop-shadow (it would
  // leave a halo past the mask) and keep only the lit top edge for depth.
  const fadeMask =
    fade === "left"
      ? "linear-gradient(90deg, transparent 0%, #000 16%, #000 100%)"
      : "linear-gradient(90deg, #000 0%, #000 84%, transparent 100%)";
  const fadeStyle: CSSProperties = fade
    ? {
        WebkitMaskImage: fadeMask,
        maskImage: fadeMask,
        ...(fade === "left" ? { borderLeft: "0" } : { borderRight: "0" }),
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.14)",
      }
    : {};
  const wideStyle: CSSProperties = wide ? { maxWidth: "none" } : {};
  const frame = (
    <div style={{ ...frameBase, ...(flat ? frameFlat : frameDepth), ...frameShape, ...fadeStyle, ...wideStyle }}>
      <div style={bar}>
        <span style={{ display: "inline-flex", gap: 7 }} aria-hidden>
          <span style={dot} />
          <span style={dot} />
          <span style={dot} />
        </span>
        {label ? <span style={url}>{label}</span> : <span style={{ margin: "0 auto" }} />}
        <span style={{ width: 47 }} />
      </div>
      {children ?? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? undefined : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      )}
    </div>
  );

  return (
    <figure style={{ margin: 0 }}>
      {flat ? (
        frame
      ) : (
        <div style={stageStyle}>
          <div style={bloom} aria-hidden />
          {frame}
        </div>
      )}
      {cap ? <figcaption style={caption}>{cap}</figcaption> : null}
    </figure>
  );
}
