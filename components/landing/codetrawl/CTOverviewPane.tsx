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

import {
  Boxes,
  Code as CodeIcon,
  FileCode,
  GitPullRequest,
  Network,
  Package,
  Sparkles,
} from "lucide-react";

import { HeadlineFinding } from "@/components/HeadlineFinding";
import { AnchorGlow } from "@/components/views/AnchorGlow";
import { HealthSummary } from "@/components/views/HealthSummary";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { QuickLookCard } from "@/components/views/QuickLookCard";
import { RollupBar } from "@/components/views/RollupBar";
import { TOK } from "@/lib/sessionTheme";
import {
  LANDING_HEADLINE,
  LANDING_HEALTH,
  LANDING_ORIENTATION_LINE,
  LANDING_OVERVIEW_REPO,
  LANDING_WORKSPACE,
} from "@/lib/landingOverview";
import {
  LANDING_SECURITY_SESSION_ID,
  LANDING_SECURITY_SNAPSHOT,
} from "@/lib/landingSecurity";

const BASE = `/session/${LANDING_SECURITY_SESSION_ID}`;

/** One icon per Workspace tab, the route's own choices. */
const CARD_ICONS: Record<string, React.ReactNode> = {
  canvas: <Network size={15} />,
  imports: <FileCode size={15} />,
  code: <CodeIcon size={15} />,
  architecture: <Boxes size={15} />,
  packages: <Package size={15} />,
  prs: <GitPullRequest size={15} />,
  insights: <Sparkles size={15} />,
};

/** The route's ROLLUP_TIERS, which is a local const rather than an export. The
 *  counting is one filter per tier, so a new status would show up as segments
 *  that no longer sum to six rather than as a silently wrong bar. */
const ROLLUP_TIERS = [
  { status: "critical", color: TOK.rose, label: "critical" },
  { status: "warning", color: TOK.amber, label: "need work" },
  { status: "healthy", color: TOK.accent, label: "healthy" },
  { status: "solo", color: TOK.textSecondary, label: "solo" },
  { status: "unknown", color: TOK.textMuted, label: "not measured" },
] as const;

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

      {/* The repo's own GitHub topics, the route's own chip markup. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
        {LANDING_SECURITY_SNAPSHOT.repo.topics.slice(0, 12).map((t) => (
          <span
            key={t}
            style={{
              fontSize: 12,
              padding: "1px 8px",
              borderRadius: 4,
              background: TOK.surface,
              color: TOK.textMuted,
              border: `1px solid ${TOK.border}`,
            }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Orientation + posture. The strip is the product's; the segment counts
          are one filter per tier over the same six tiles the strip sits above,
          so the bar and the tiles cannot disagree. */}
      <OrientationStrip
        line={LANDING_ORIENTATION_LINE}
        rollup={
          <RollupBar
            segments={ROLLUP_TIERS.map((t) => ({
              count: LANDING_HEALTH.filter((s) => s.status === t.status).length,
              color: t.color,
              label: t.label,
            }))}
            total={LANDING_HEALTH.length}
          />
        }
      />

      {/* The product wraps the finding card in a glow toned by its severity. */}
      <AnchorGlow tone={LANDING_HEADLINE.severity === "critical" ? "warm" : "bone"}>
        <HeadlineFinding headline={LANDING_HEADLINE} sessionId={LANDING_SECURITY_SESSION_ID} />
      </AnchorGlow>

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

      {/* Workspace — the product's own tiles, each carrying that tab's headline
          stat. This is the block that makes the shot read as a place you can go
          rather than a summary you have finished reading, and every tile is a
          live link into the demo session. */}
      <div style={{ marginTop: 26 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              fontWeight: 500,
              color: TOK.textMuted,
            }}
          >
            Workspace
          </span>
          <span style={{ fontSize: 12, color: TOK.textMuted }}>
            · click any card to open
          </span>
        </div>
        <div
          style={{
            display: "grid",
            // Seven cards want a row length that does not strand one on its
            // own. Measured in place, the hero's grid is 1141px: at a 300px
            // minimum auto-fit lays THREE columns and the last row holds a
            // single card; at 260 it lays four and breaks 4 + 3. The product's
            // own grid is a fixed three columns, but the session view gives
            // 260px to a sidebar this frame does not have.
            //
            // min(…, 100%) rather than a bare 260px: below that width auto-fit
            // still lays a 260px track, which on a 375px phone is wider than
            // the pane it sits in and clips the card's right edge.
            gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
            gap: 12,
          }}
        >
          {LANDING_WORKSPACE.map((c) => (
            <QuickLookCard
              key={c.tab}
              href={`${BASE}/${c.tab}`}
              icon={CARD_ICONS[c.tab]}
              label={c.label}
              stat={c.stat}
              description={c.description}
              accent={c.accent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
