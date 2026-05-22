// OpenGraph share-card image (v0.75 polish track).
//
// When someone pastes a RepoBaron URL into Slack, Discord, Twitter,
// LinkedIn, iMessage, etc., the platform fetches og:image and
// renders a preview card. Without this file we either get nothing
// or whatever the page's first <img> happens to be — neither lands
// the brand. Next.js 13+ auto-routes `app/opengraph-image.tsx` to
// /opengraph-image and sets og:image in the head.
//
// Design: dark canvas (matches the in-app theme so the preview
// feels continuous with the product), the concept-A logo on the
// left, wordmark + value-prop strapline on the right. 1200×630 is
// the standard OG dimensions — Twitter, LinkedIn, Discord, Slack,
// and Facebook all crop to this aspect.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "RepoBaron — map any GitHub repo";
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
          background: "#0a0a0c",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row: logo + wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="32"
              cy="32"
              r="26"
              stroke="#10b981"
              strokeWidth="3"
              opacity="0.3"
            />
            <circle
              cx="32"
              cy="32"
              r="17"
              stroke="#10b981"
              strokeWidth="3"
              opacity="0.6"
            />
            <circle
              cx="32"
              cy="32"
              r="9"
              stroke="#10b981"
              strokeWidth="3"
              opacity="0.9"
            />
            <circle cx="32" cy="32" r="4" fill="#10b981" />
          </svg>
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#E8E8EE",
            }}
          >
            RepoBaron
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
              color: "#E8E8EE",
              maxWidth: 1000,
            }}
          >
            Map any GitHub repo.
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              color: "#10b981",
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
            color: "#9898A8",
            letterSpacing: "0.02em",
          }}
        >
          repobaron.com
        </div>
      </div>
    ),
    size
  );
}
