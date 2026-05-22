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
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/theme";
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
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Insights
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          AI commentary on grounded signals.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          A 150-word repo briefing plus the three-column health
          verdict. Every claim is anchored to a deterministic signal
          from the analysis pipeline — no LLM guesses, no
          hallucinations.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-8">
        <AiSummaryPanel sessionId={session.id} snapshot={current} />
        <HealthPanel sessionId={session.id} snapshot={current} />
      </div>
    </main>
  );
}
