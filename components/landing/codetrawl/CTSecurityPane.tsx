// The Security screen, mounted rather than photographed — and, unlike the two
// panes before it, not redrawn either.
//
// CTCodePane and CTBlastDiagram had to reproduce the product's markup because
// CodeView and FaultlineBlastCanvas are client components. This screen is not:
// app/session/[id]/security/page.tsx is forty-odd lines of getSession →
// OrientationStrip → SecurityPanel, all server, no AI, no fetch. So the landing
// mounts THE ACTUAL PANEL and hands it a pinned snapshot.
//
// That closes the drift question rather than testing around it. The three
// scanner states, the count labels, the "N curated supply-chain attacks"
// subtitle, the severity ordering and the rollup arithmetic are computed at
// render time by SecurityPanel — if the product changes any of them, this shot
// changes with it, with no test to keep in step and nothing to re-transcribe.
//
// TWO THINGS THE MOUNT NEEDS.
//
// 1. The mono font. FindingsList styles with Tailwind's `font-mono`, which
//    resolves to --font-mono; globals.css points that at Geist Mono and the
//    session layout re-points it at the CodeTrawl face. The landing's .ct scope
//    defines --ct-mono and never touches --font-mono, so a naive mount would
//    render every file path and code excerpt in a face that appears nowhere
//    else on the page. The wrapper below re-points it exactly as
//    app/session/[id]/layout.tsx does.
//
// 2. A real session id. Every finding row links into /session/<id>/…; passing
//    the demo id makes those land on the live, anonymously-viewable analysis
//    this data was swept from — so the shot is also a door into the product.

import { SecurityPanel } from "@/components/views/security/SecurityPanel";
import { TOK } from "@/lib/sessionTheme";
import {
  LANDING_SECURITY_SNAPSHOT,
  LANDING_SECURITY_SESSION_ID,
} from "@/lib/landingSecurity";

/** From app/session/[id]/layout.tsx — the session surface re-points the font
 *  variables rather than setting a family, because product components reach for
 *  --font-mono and --font-sans through Tailwind utility classes. */
const FONT_VARS = {
  "--font-sans": "var(--font-ct-display)",
  "--font-mono": "var(--font-ct-mono)",
  "--font-geist-sans": "var(--font-ct-display)",
  "--font-geist-mono": "var(--font-ct-mono)",
  fontFamily: "var(--font-ct-display)",
} as React.CSSProperties;

export function CTSecurityPane() {
  return (
    <div style={{
        ...FONT_VARS,
        background: TOK.surface,
        padding: "22px 24px 26px",
        // The hero centres its text; the product does not. Without this the
        // eyebrow and any block-level child inherit the centring.
        textAlign: "left",
      }}>
      {/* The page's own header, which lives as inline JSX in the route rather
          than in a component — so it is the one part here that is copied. Kept
          to the two lines that carry meaning; the route's third line is a
          reading instruction for someone already on the page. */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            fontWeight: 500,
            color: TOK.textMuted,
            marginBottom: 10,
          }}
        >
          Security · Code + dependencies
        </div>
        <h3
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: TOK.textPrimary,
            margin: 0,
          }}
        >
          What deserves a security review.
        </h3>
      </div>

      <SecurityPanel
        snapshot={LANDING_SECURITY_SNAPSHOT}
        sessionId={LANDING_SECURITY_SESSION_ID}
      />
    </div>
  );
}
