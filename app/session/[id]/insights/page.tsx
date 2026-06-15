// /session/[id]/insights — AI Summary + Health Check (v0.44, slimmed v0.60).
//
// AI prose layer that sits on top of the deterministic signals already
// surfaced on the Overview. The Overview's "Health at a glance" strip
// answers "what" — this page answers "why, in plain English". Two
// panels:
//   1. AI Briefing — what the repo is, in 150-200 words.
//   2. Health Check — the three-column verdict grounded in 20 signals.
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
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { TOK } from "@/lib/sessionTheme";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";
import { UpgradePrompt } from "@/components/billing/UpgradePrompt";

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

  // Tier gate: AI Insights is unlocked from Standing docket tier up. Open case
  // users land on the upgrade prompt instead of the panels — we
  // don't want to spend Anthropic tokens on free users + this is
  // the strongest conversion hook in the product
  const authSession = await getAuthSession();
  const hasAiInsights = authSession
    ? await canAccess(authSession.user.id, "aiInsights")
    : false;

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
          read. Every claim is anchored to a deterministic signal
          from the analysis pipeline — no LLM guesses, no
          hallucinations.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-8">
        {hasAiInsights ? (
          <>
            <AiSummaryPanel sessionId={session.id} snapshot={current} />
            <HealthPanel sessionId={session.id} snapshot={current} />
          </>
        ) : (
          <UpgradePrompt
            featureName="AI Insights"
            requiredTier="standing-docket"
            context="The deterministic Health Summary on your Overview page is free forever. AI Briefing + Health Check grade — the prose layer that explains the signals in plain English — needs Standing docket."
            unlockedFeatures={[
              "AI Briefing — 150-word repo profile generated from your codebase",
              "Health Check grade — three-column \"what works / dig deeper / open questions\" grounded in 20 signals",
              "Structural diff between snapshots (see what changed semantically)",
              "Auto-extracted Architecture diagrams",
              "Unlimited saved sessions + private repos",
            ]}
          />
        )}
      </div>
    </main>
  );
}
