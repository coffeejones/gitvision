// App favicon (v0.75). Next.js 13+ auto-generates favicon, apple-icon,
// and OpenGraph icons from files matching `app/icon.{ts,tsx,png,svg}`,
// `app/apple-icon.tsx`, etc. Returning ImageResponse here lets us
// render the icon SVG as PNG at build time so browsers without
// SVG-favicon support still get a clean mark.
//
// Geometry mirrors components/Logo.tsx (concept A — concentric rings
// + centre dot) but is duplicated here rather than imported because
// ImageResponse runs in an Edge runtime that can't pull in our full
// component tree (TOK theme, lucide icons, etc.). Keep both files in
// sync if the mark is refined.

import { ImageResponse } from "next/og";

export const runtime = "edge";

// Render at 32×32 — browsers scale up/down from here. 32 is the
// "high-DPI tab favicon" size most desktop browsers prefer.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Transparent so the favicon sits cleanly on any browser
          // tab background — light, dark, or in-between. The sharp
          // black square that this used to render looked like a
          // bug, not a brand.
          background: "transparent",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Outer ring */}
          <circle
            cx="32"
            cy="32"
            r="26"
            stroke="#10b981"
            strokeWidth="4"
            opacity="0.3"
          />
          {/* Middle ring */}
          <circle
            cx="32"
            cy="32"
            r="17"
            stroke="#10b981"
            strokeWidth="4"
            opacity="0.6"
          />
          {/* Inner ring */}
          <circle
            cx="32"
            cy="32"
            r="9"
            stroke="#10b981"
            strokeWidth="4"
            opacity="0.9"
          />
          {/* Centre dot */}
          <circle cx="32" cy="32" r="5" fill="#10b981" />
        </svg>
      </div>
    ),
    size
  );
}
