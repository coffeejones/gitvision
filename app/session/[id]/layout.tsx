// Session route layout (v0.42).
//
// Wraps every /session/[id]/... page with the SessionToolbar (top-bar
// actions: refresh / share / overflow) and the SessionShell (left
// sidebar with workspace navigation). Each tab now has its own route
// rendered as `children` here.
//
// Why a layout: the toolbar + sidebar must persist across tab
// navigation without flicker, so they live in a shared layout.
// Next.js App Router re-renders only the changed segment, which means
// switching from /code to /canvas keeps the sidebar instance, the
// scrolltop, and any client state we hang on the shell.
//
// The session is fetched once here and passed to SessionToolbar +
// SessionShell. Each route's page.tsx fetches its own copy too —
// Next.js dedupes within a request, and the per-page fetch keeps
// pages independently testable + composable without a layout-context
// dance.

import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { SessionToolbar } from "@/components/SessionToolbar";
import { SessionShell } from "@/components/SessionShell";
import { HideOnMarketing } from "@/components/MarketingModeWrapper";
import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";
import { TOK } from "@/lib/sessionTheme";

export const dynamic = "force-dynamic";

// The session surface reads CodeTrawl tokens (lib/sessionTheme.ts) but inherits
// the global Geist fonts. Repoint Tailwind's font vars to the CodeTrawl
// families (Schibsted Grotesk + Fragment Mono) for this subtree, so the shell
// + every analysis view renders in the brand type.
//
// We override BOTH the Tailwind theme vars (--font-sans/--font-mono, used by the
// `font-sans`/`font-mono` utilities) AND the underlying --font-geist-* roots,
// because several analysis views hardcode `fontFamily: var(--font-geist-mono)`
// inline — overriding only --font-mono would miss those.
//
// `background` paints the CodeTrawl warm bg (TOK.bg → CH #0c0b0b) over the
// global body bg (cool #14141B from globals.css), so the transparent main
// content area matches the warm sidebar instead of letting the cool bg peek.
const FONT_VARS = {
  "--font-sans": "var(--font-ct-display)",
  "--font-mono": "var(--font-ct-mono)",
  "--font-geist-sans": "var(--font-ct-display)",
  "--font-geist-mono": "var(--font-ct-mono)",
  fontFamily: "var(--font-ct-display)",
  background: TOK.bg,
  minHeight: "100vh",
} as CSSProperties;

export default async function SessionLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  // v0.81 read-side access gate: sessions analyzed from a PRIVATE repo
  // are owner-only. Anyone else hitting the URL gets a generic 404,
  // identical to "session doesn't exist" — we deliberately don't reveal
  // existence + visibility separately, so a leaked URL gives away
  // nothing more than a random guess would.
  //
  // Public-repo sessions short-circuit (no auth lookup needed). This is
  // the single chokepoint for ALL /session/[id]/* sub-routes (canvas,
  // architecture, code, insights, packages, imports, prs) — Next.js
  // runs the layout before any nested page renders, so adding the
  // check here covers every read path with one edit.
  const allowed = await requireSessionReadAccess(session);
  if (!allowed) notFound();

  // A session with no snapshots is a corrupt/partial write — every
  // downstream component (SessionToolbar, SessionShell) types `snapshot`
  // as a non-optional AnalysisSnapshot and would crash the render reading
  // `.repo.fullName` on undefined. Treat it as "not found" rather than a
  // raw 500.
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  return (
    <div className={`${ctDisplay.variable} ${ctMono.variable}`} style={FONT_VARS}>
      {/* HideOnMarketing strips the top toolbar when ?marketing=1 is
       *  in the URL. Used for taking clean session-page screenshots
       *  for marketing assets (sidebar stays — adds product
       *  credibility). */}
      <HideOnMarketing>
        <SessionToolbar
          sessionId={session.id}
          sessionName={session.name}
          snapshot={current}
          targetId="screenshot-target"
          updatedAtISO={session.updatedAt}
          snapshotCount={session.snapshots.length}
        />
      </HideOnMarketing>

      <SessionShell sessionId={session.id} snapshot={current}>
        {children}
      </SessionShell>
    </div>
  );
}
