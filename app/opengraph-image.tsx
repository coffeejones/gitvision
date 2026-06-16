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

export const alt = "CodeTrawl — map any GitHub repo";
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={OG_ICON_DATA_URI} width="80" height="80" alt="" />
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
          <div
            style={{
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#f2efea",
              maxWidth: 1000,
            }}
          >
            Map any GitHub repo.
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              // v0.80: pulled emerald accent in favour of off-white-on-
              // muted as the brand pulls away from green.
              color: "#9c968e",
              maxWidth: 950,
            }}
          >
            Blast radius, structural duplicates, untested hotspots —
            across 7 languages.
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
