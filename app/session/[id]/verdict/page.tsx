// /session/[id]/verdict — the Final grade page (v0.82+, Phase C).
//
// The climax of the CodeTrawl experience: each of the four jury
// departments (Health, Security, Forensics, Supply) votes on the
// codebase based on the deterministic signals from extractHealthSignals
// + standalone security scanners. Their votes roll up into one of
// three outcomes — Cleared, Conditional, Returned for
// Revision — rendered as a large color-keyed seal at the top of the
// page (VerdictHero), followed by per-department breakdowns
// (DepartmentRulingCard) so the user can see what each office found
// and where to dig deeper.
//
// Phase C-2 layers an AI judge's bench statement (JudgeStatement)
// between the hero and the department rulings, grounded entirely in
// the deterministic Verdict object so every claim is auditable.
// Plus tier gate identical to /insights — the deterministic
// verdict stays free forever; the bench statement requires Plus.
//
// Server-rendered. The verdict is a pure function of the snapshot
// so server-rendering keeps the page fast + cache-friendly. No
// interactivity needed for the static view; future iterations could
// add a "dissent" annotation where the user marks a department's
// vote as misclassified.

import { notFound } from "next/navigation";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { consumeAiBudget } from "@/lib/aiBudget";
import { computeVerdict } from "@/lib/intelligence/verdict";
import { computeAdoptionRead } from "@/lib/intelligence/adoptionRead";
import { generateRecommendations } from "@/lib/recommendations";
import { generateRecommendationNarrative } from "@/lib/intelligence/recommendationNarrative";
import { generateVerdictNarrative } from "@/lib/intelligence/verdictNarrative";
import { TOK } from "@/lib/sessionTheme";
import { VerdictHero } from "@/components/views/verdict/VerdictHero";
import { AdoptionReadCard } from "@/components/views/verdict/AdoptionRead";
import { DepartmentRulingCard } from "@/components/views/verdict/DepartmentRulingCard";
import { JudgeStatement } from "@/components/views/verdict/JudgeStatement";
import { RecommendationsPanel } from "@/components/views/verdict/RecommendationsPanel";

export const dynamic = "force-dynamic";

export default async function VerdictRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const latest = session.snapshots[session.snapshots.length - 1];
  const verdict = computeVerdict(latest);
  const adoption = computeAdoptionRead(latest, verdict);
  // Deterministic, prioritized "what to fix" — free for everyone (rule-based,
  // no AI), same as the hero and adoption read.
  const recommendations = generateRecommendations(latest);
  const sessionBase = `/session/${session.id}`;

  // Gate: the AI bench statement is free with any account (same gate as
  // /insights — aiInsights, open to every tier in the free-phase), but the
  // generation costs tokens, so anonymous/logged-out viewers don't trigger it.
  // They still see the deterministic verdict hero + department rulings — only
  // the AI prose layer is hidden until they sign in (free).
  const authSession = await getAuthSession();
  const isDemo = isDemoSession(id);
  const hasAi =
    isDemo ||
    (authSession ? await canAccess(authSession.user.id, "aiInsights") : false);

  // Read-through cache: the bench statement is a stable function of the
  // snapshot, so persist it on first generation and reuse it — paid users
  // don't re-spend on repeat views. Public demo sessions serve a PRE-BAKED
  // narrative (see /api/admin/bake-demo-ai) and never generate on a view.
  //
  // CRITICAL: scope `narrative` to ENTITLED viewers (hasAi), not merely "a
  // cached narrative exists". A public session's cache is seeded the first
  // time any signed-in user views it; reading it unconditionally would leak the
  // account-gated bench statement to anonymous viewers of that same public
  // session (the JudgeStatement render keys off `narrative`). So a non-entitled
  // (logged-out) viewer gets null here regardless of what's cached.
  let narrative = hasAi ? (latest.verdictNarrative ?? null) : null;
  // Generate only for a paid (non-demo) viewer on a cache miss, and only if the
  // global daily AI budget allows — same kill-switch the POST AI routes honor,
  // so the inline path can't outrun the cap. Budget is consumed lazily (short-
  // circuit) so demo/free/cached views never touch it.
  if (!narrative && hasAi && !isDemo && consumeAiBudget().ok) {
    narrative = await generateVerdictNarrative(verdict, latest.repo.fullName);
    if (narrative) {
      await patchLatestSnapshot(session.id, { verdictNarrative: narrative });
    }
  }

  // Same Plus-gated, read-through-cached treatment for the recommendations
  // "where to start" prose. Only entitled viewers see it; only generated for a
  // paid non-demo viewer when there's something to summarize and budget allows.
  let recNarrative = hasAi ? (latest.recommendationNarrative ?? null) : null;
  if (
    !recNarrative &&
    hasAi &&
    !isDemo &&
    recommendations.items.length > 0 &&
    consumeAiBudget().ok
  ) {
    recNarrative = await generateRecommendationNarrative(
      recommendations,
      latest.repo.fullName,
    );
    if (recNarrative) {
      await patchLatestSnapshot(session.id, {
        recommendationNarrative: recNarrative,
      });
    }
  }

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Final grade · where four lenses land
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Four lenses. One grade.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Each lens scores the codebase using the same 20 deterministic
          signals you see across the workspace. The combined grade is the
          bottom line. Every claim below is anchored to a signal you can
          drill into.
        </p>
      </header>

      <VerdictHero verdict={verdict} />

      {/* The Read — adoption. Free for everyone: a pure reweighting of the
          deterministic verdict into an ADOPT / GUARDED / AVOID call. No AI,
          no token cost, so it sits above the Plus-gated bench statement. */}
      <AdoptionReadCard read={adoption} />

      {/* AI summary, when available. Plus tier gated +
          conditional on ANTHROPIC_API_KEY being set. Renders nothing
          for Free users or when the AI feature is off — the
          deterministic grade on the hero above carries the page on
          its own. */}
      {narrative && (
        <JudgeStatement text={narrative.text} model={narrative.model} />
      )}

      {/* What to fix — the actionable payoff. The cards are deterministic +
          free for all (incl. demo viewers); the optional AI "where to start"
          lead-in is Plus-gated (narrative is null for free viewers). */}
      <RecommendationsPanel
        recommendations={recommendations}
        narrative={recNarrative}
      />

      <section className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Lens breakdown
        </span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {verdict.rulings.map((ruling) => (
            <DepartmentRulingCard
              key={ruling.id}
              ruling={ruling}
              sessionBase={sessionBase}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
