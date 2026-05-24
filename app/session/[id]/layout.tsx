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

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { SessionToolbar } from "@/components/SessionToolbar";
import { SessionShell } from "@/components/SessionShell";
import { HideOnMarketing } from "@/components/MarketingModeWrapper";

export const dynamic = "force-dynamic";

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

  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <>
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
    </>
  );
}
