// /session/[id]/verdict — the Final grade page (v0.82+, Phase C).
//
// The climax of the RepoJury experience: each of the four jury
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
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { computeVerdict } from "@/lib/intelligence/verdict";
import { generateVerdictNarrative } from "@/lib/intelligence/verdictNarrative";
import { TOK } from "@/lib/sessionTheme";
import { VerdictHero } from "@/components/views/verdict/VerdictHero";
import { DepartmentRulingCard } from "@/components/views/verdict/DepartmentRulingCard";
import { JudgeStatement } from "@/components/views/verdict/JudgeStatement";

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
  const sessionBase = `/session/${session.id}`;

  // Tier gate: AI bench statement is a Plus tier feature (same gate
  // as /insights). Free users still see the deterministic verdict
  // hero + department rulings — only the AI prose layer is hidden.
  // Skip the Anthropic call entirely for free users so we don't
  // burn tokens on impressions that won't see the output.
  const authSession = await getAuthSession();
  const hasAi = authSession
    ? await canAccess(authSession.user.id, "aiInsights")
    : false;
  const narrative = hasAi
    ? await generateVerdictNarrative(verdict, latest.repo.fullName)
    : null;

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

      {/* AI summary, when available. Plus tier gated +
          conditional on ANTHROPIC_API_KEY being set. Renders nothing
          for Free users or when the AI feature is off — the
          deterministic grade on the hero above carries the page on
          its own. */}
      {narrative && (
        <JudgeStatement text={narrative.text} model={narrative.model} />
      )}

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
