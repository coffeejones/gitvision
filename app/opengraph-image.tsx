// OpenGraph share-card image.
//
// When someone pastes a CodeTrawl URL into Slack, Discord, Twitter,
// LinkedIn, iMessage, etc., the platform fetches og:image and
// renders a preview card. Without this file we either get nothing
// or whatever the page's first <img> happens to be — neither lands
// the brand. Next.js auto-routes `app/opengraph-image.tsx` to
// /opengraph-image and sets og:image in the head.
//
// Design: bitumen canvas (matches the CodeTrawl theme so the preview
// feels continuous with the product), the orange swirl mark + wordmark
// top-left, value-prop strapline below. 1200×630 is the standard OG
// dimension — Twitter, LinkedIn, Discord, Slack, Facebook all crop to it.

import { ImageResponse } from "next/og";
import { OG_ICON_DATA_URI } from "@/lib/ogIcon";

export const runtime = "edge";

export const alt = "CodeTrawl — get to know any codebase";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0b0a",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row: swirl mark + wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "22px",
          }}
        >
          {/* next/og (Satori) needs numeric dimensions via style — string
              width/height attributes ("80") are rejected ("Invalid value")
              and the mark silently drops out of the card. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={OG_ICON_DATA_URI}
            width={80}
            height={80}
            style={{ width: 80, height: 80 }}
            alt=""
          />
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#f2efea",
            }}
          >
            CodeTrawl
          </div>
        </div>

        {/* Bottom: headline + strapline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Carries the landing's H1 verbatim, orange period included — this
              card is the first impression for every shared session URL, so it
              should be the same sentence a visitor lands on. Satori needs an
              explicit display:flex on any element with more than one child,
              hence the row rather than a nested <span>. */}
          <div
            style={{
              display: "flex",
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#f2efea",
              maxWidth: 1000,
            }}
          >
            <div>Get to know any codebase</div>
            <div style={{ color: "#ff4f00" }}>.</div>
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              // v0.80: pulled emerald accent in favour of off-white-on-
              // muted as the brand pulls away from green.
              color: "#9c968e",
              // 700, not 950: the "computed, never generated" mark sits in the
              // bottom-right corner, and a wider measure runs the strapline's
              // first line underneath it.
              maxWidth: 700,
            }}
          >
            What every part does, how it all connects, and what breaks if you
            touch it.
          </div>
        </div>

        {/* Bottom-right corner: domain hint */}
        <div
          style={{
            position: "absolute",
            bottom: 80,
            right: 80,
            fontSize: 22,
            color: "#9c968e",
            letterSpacing: "0.02em",
          }}
        >
          computed, never generated
        </div>
      </div>
    ),
    size
  );
}
