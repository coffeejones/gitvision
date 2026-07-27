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
import { isDemoSession } from "@/lib/demoSessions";
import { TOK } from "@/lib/sessionTheme";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";
import { SignInToUnlock } from "@/components/billing/SignInToUnlock";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { RollupBar } from "@/components/views/RollupBar";

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

  // Tier gate: AI Insights is unlocked from Plus tier up. Free
  // users land on the upgrade prompt instead of the panels — we
  // don't want to spend Anthropic tokens on free users + this is
  // the strongest conversion hook in the product. Public demo
  // sessions bypass the gate and render the panels read-only on
  // PRE-BAKED output (see /api/admin/bake-demo-ai) — so a logged-out
  // visitor sees the AI layer without ever triggering generation.
  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  const hasAiInsights =
    isDemo ||
    (authSession
      ? await canAccess(authSession.user.id, "aiInsights")
      : false);

  // Phase 2 rollup: the three-column health verdict, folded to a count line.
  // Only meaningful once the health check has been generated (the columns are
  // lazy) AND the viewer can see the panels — so the "start with 'Where to dig
  // deeper'" action never points at a column that isn't on the page.
  const ha = current.healthAnalysis;
  const showInsightsRollup = hasAiInsights && !!ha;
  const insightsHighCount = ha
    ? ha.signals.needsWork.filter((s) => s.severity === "high").length
    : 0;
  const insightsLine = showInsightsRollup
    ? "AI commentary on the computed signals — a plain-English briefing and a health verdict. Start with “Where to dig deeper.”"
    // Not "each anchored to a deterministic signal — never an LLM guess". That
    // is true of the health verdict, whose prompt receives the signal JSON and
    // nothing else, but not of the briefing: lib/aiSummary.ts:39 asks for "who
    // uses it, what makes it interesting" — which no field in the payload can
    // answer — and its few-shot asserts world knowledge about tailwindcss. The
    // two are different products and saying otherwise oversells the weaker one.
    : "AI commentary on the computed signals: a plain-English briefing and a health verdict. The verdict is written from the computed signals alone; the briefing also draws on what the model already knows about well-known projects.";

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Insights"
        title="AI commentary on grounded signals."
        line={insightsLine}
        rollup={
          showInsightsRollup && ha ? (
            <RollupBar
              segments={[
                {
                  count: ha.signals.working.length,
                  color: TOK.accent,
                  label: "working",
                },
                {
                  count: ha.signals.needsWork.length,
                  color: TOK.amber,
                  label: "to dig into",
                },
                {
                  count: ha.signals.questions.length,
                  color: TOK.textMuted,
                  label: "open questions",
                },
              ]}
              trailing={
                insightsHighCount > 0
                  ? `${insightsHighCount} high-severity`
                  : undefined
              }
            />
          ) : undefined
        }
      />
      <div id="screenshot-target" className="flex flex-col gap-8">
        {hasAiInsights ? (
          <>
            <AiSummaryPanel
              sessionId={session.id}
              snapshot={current}
              readOnly={isDemo}
            />
            <HealthPanel
              sessionId={session.id}
              snapshot={current}
              readOnly={isDemo}
            />
          </>
        ) : (
          <SignInToUnlock
            featureName="AI Insights"
            redirectTo={`/session/${id}/insights`}
            context="The deterministic Health Summary on your Overview page is free to everyone. The AI Briefing + Health Check grade — the prose layer that explains the signals in plain English — is free with any account."
          />
        )}
      </div>
    </main>
  );
}
