// /session/[id]/insights — AI Summary + Health Check (v0.44, slimmed v0.60).
//
// AI prose layer that sits on top of the deterministic signals already
// surfaced on the Overview. The Overview's "Health at a glance" strip
// answers "what" — this page answers "why, in plain English". Two
// panels:
//   1. AI Briefing — what the repo is, in 150-200 words.
//   2. Health Check — the three-column verdict grounded in 17 signals.
//
// v0.60 trim: the page header used to repeat what the panel headers
// already say. Dropped the 4-line intro paragraph in favor of a single
// muted-line provenance hint, since alpha users were hitting the page
// from anchored Overview-tile clicks and didn't need re-introduction.
//
// If ANTHROPIC_API_KEY isn't set, both panels render their own empty
// state explaining that AI features are off.

import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getSession } from "@/lib/storage";
import { STYLE, TOK } from "@/lib/theme";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";

export const dynamic = "force-dynamic";

export default async function InsightsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 py-8 flex flex-col gap-6 max-w-7xl mx-auto w-full">
      <div id="screenshot-target" className="flex flex-col gap-6">
        <header className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: TOK.accent }} />
            <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
              Insights · AI commentary on deterministic signals
            </span>
          </div>
        </header>

        <AiSummaryPanel sessionId={session.id} snapshot={current} />
        <HealthPanel sessionId={session.id} snapshot={current} />
      </div>
    </main>
  );
}
