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
import { HEALTH_SIGNAL_COUNT } from "@/lib/intelligence/healthSummary";

export const runtime = "edge";

export const alt = "CodeTrawl — understand the system and change it with confidence";
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

        {/* The share card carries the selected landing's exact promise. It is
            rendered from code and brand primitives rather than generated art,
            so shared session URLs look like the product they open. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "13px",
              color: "#ff8a50",
              fontSize: 17,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <div style={{ width: 42, height: 1, background: "#ff4f00" }} />
            Deterministic codebase intelligence
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 72,
              fontWeight: 600,
              lineHeight: 0.98,
              letterSpacing: "-0.045em",
              color: "#f2efea",
              maxWidth: 1040,
            }}
          >
            <div>Understand the system.</div>
            <div style={{ color: "#aaa49c" }}>Change it with confidence.</div>
          </div>
          <div
            style={{
              fontSize: 25,
              lineHeight: 1.35,
              color: "#9c968e",
              maxWidth: 850,
            }}
          >
            Structure, history, security and change impact — with evidence
            attached to every finding.
          </div>
        </div>

        {/* Bottom instrumentation rail mirrors the compact proof rail directly
            below the landing's hero. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 22,
            borderTop: "1px solid #2b2926",
            color: "#77716b",
            fontSize: 16,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", gap: "34px" }}>
            {/* ONE child, not two. Satori (which renders this card) rejects a
                div with more than one child unless it declares an explicit
                display, and `{N} computed signals` is two children — the number
                and the text. Interpolating into a single template literal keeps
                it one text node. Caught by the route returning nothing at all;
                a broken OG card is invisible until someone shares a link. */}
            <div>{`${HEALTH_SIGNAL_COUNT} computed signals`}</div>
            <div>File → line evidence</div>
            <div>AI optional</div>
          </div>
          <div style={{ color: "#f2efea", textTransform: "lowercase" }}>
            codetrawl.com
          </div>
        </div>
      </div>
    ),
    size
  );
}
