// The hero shot — the Overview screen, mounted rather than photographed.
//
// Same argument as CTSecurityPane: HeadlineFinding and HealthSummary are server
// components taking plain props, so the landing renders THE PRODUCT rather than
// a picture of it. The severity colour and icon on the finding card, the CTA
// wording, the six tiles and their status styling are all computed by those
// components — nothing here restates them, so nothing here can fall behind.
//
// The photograph it replaces had. It was taken on 2026-07-20 and by today its
// Team tile reads "Needs work — 2 active folders maintained by a single
// contributor" where the analyzer says healthy, and five of its six evidence
// sentences are sentences the product no longer writes. Nobody noticed, because
// nobody re-reads a picture.
//
// WHAT IS NOT HERE. The session chrome — top bar and sidebar — is not mounted:
// SessionShell and SessionToolbar are client components carrying a router,
// modals and html-to-image, some 1,400 lines of JavaScript that a still picture
// has no use for. CTScreenshot's window frame already says "this is the app",
// the same way it does for the two panes before this one. The metadata row is
// omitted too, for a reason worth reading in lib/landingOverview.ts.

import { HeadlineFinding } from "@/components/HeadlineFinding";
import { HealthSummary } from "@/components/views/HealthSummary";
import { TOK } from "@/lib/sessionTheme";
import {
  LANDING_HEADLINE,
  LANDING_HEALTH,
  LANDING_OVERVIEW_REPO,
} from "@/lib/landingOverview";
import { LANDING_SECURITY_SESSION_ID } from "@/lib/landingSecurity";

/** From app/session/[id]/layout.tsx — product components reach for --font-mono
 *  and --font-sans through Tailwind utility classes, and the .ct scope defines
 *  neither. */
const FONT_VARS = {
  "--font-sans": "var(--font-ct-display)",
  "--font-mono": "var(--font-ct-mono)",
  "--font-geist-sans": "var(--font-ct-display)",
  "--font-geist-mono": "var(--font-ct-mono)",
  fontFamily: "var(--font-ct-display)",
} as React.CSSProperties;

export function CTOverviewPane() {
  return (
    <div style={{
        ...FONT_VARS,
        background: TOK.surface,
        padding: "22px 24px 26px",
        // The hero centres its text; the product does not. Without this the
        // eyebrow and any block-level child inherit the centring.
        textAlign: "left",
      }}>
      {/* The route renders this header as inline JSX rather than a component,
          so it is the one part copied instead of mounted. The product's H1 is
          SessionNameEditor, a client component whose whole purpose is renaming
          the session — inert here, so a plain heading stands in. */}
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
        Overview
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: TOK.textPrimary,
            margin: 0,
          }}
        >
          {LANDING_OVERVIEW_REPO.fullName}
        </h3>
        <a
          href={LANDING_OVERVIEW_REPO.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, fontFamily: "var(--ct-mono)", color: TOK.textMuted }}
        >
          {LANDING_OVERVIEW_REPO.fullName} ↗
        </a>
      </div>

      <p
        style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: TOK.textSecondary,
          margin: "10px 0 20px",
          maxWidth: "48ch",
        }}
      >
        {LANDING_OVERVIEW_REPO.description}
      </p>

      <HeadlineFinding headline={LANDING_HEADLINE} sessionId={LANDING_SECURITY_SESSION_ID} />

      {/* HealthSummary draws its own "HEALTH AT A GLANCE · rule-based signals ·
          no AI required" header — a first draft repeated it here and the shot
          carried the line twice. One more argument for mounting over redrawing:
          the duplicate was visible immediately, where a redrawn header that had
          merely fallen out of date would not have been. */}
      <div style={{ marginTop: 22 }}>
        <HealthSummary
          summaries={LANDING_HEALTH}
          sessionId={LANDING_SECURITY_SESSION_ID}
        />
      </div>
    </div>
  );
}
