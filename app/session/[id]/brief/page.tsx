// /session/[id]/brief — workspace-native goal chooser.
//
// The workspace remains visible in the shared layout. This page only helps the
// reader choose the first question; it does not replace or hide any analysis
// surface. Three goals open deterministic cross-surface briefs. The change goal
// opens Faultline, which asks for the concrete file that a truthful answer
// requires.

import { notFound } from "next/navigation";

import { GuidedGoalPicker } from "@/components/views/GuidedGoalPicker";
import { buildWorkspaceGoalGuidance } from "@/lib/brief/guidance";
import { HEALTH_SIGNAL_COUNT } from "@/lib/intelligence/healthSummary";
import { getSessionCached } from "@/lib/sessionCache";

export const dynamic = "force-dynamic";

export default async function BriefChooserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionCached(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();
  const guidance = buildWorkspaceGoalGuidance(current, id);

  return (
    <main className="px-8 pt-12 pb-20 max-w-6xl mx-auto w-full">
      <GuidedGoalPicker
        guidance={guidance}
        signalCount={HEALTH_SIGNAL_COUNT}
        functionCount={current.codeGraph?.functions.length ?? 0}
        snapshotCount={session.snapshots.length}
      />
    </main>
  );
}
