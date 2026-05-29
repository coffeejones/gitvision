// /session/[id]/verdict — the Final Verdict page (v0.82+, Phase C).
//
// The climax of the RepoJury experience: each of the four jury
// departments (Health, Security, Forensics, Supply) votes on the
// codebase based on the deterministic signals from extractHealthSignals
// + standalone security scanners. Their votes roll up into one of
// three outcomes — Cleared, Conditional Approval, Returned for
// Revision — rendered as a large color-keyed seal at the top of the
// page (VerdictHero), followed by per-department breakdowns
// (DepartmentRulingCard) so the user can see what each office found
// and where to dig deeper.
//
// Phase C-1 ships the deterministic path only. Phase C-2 will add an
// AI judge's-statement narrative on top of the deterministic
// summary, grounded in the same Verdict object so every claim is
// auditable. Knight-tier gate identical to /insights — the
// deterministic verdict stays free forever.
//
// Server-rendered. The verdict is a pure function of the snapshot
// so server-rendering keeps the page fast + cache-friendly. No
// interactivity needed for the static view; future iterations could
// add a "dissent" annotation where the user marks a department's
// vote as misclassified.

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { computeVerdict } from "@/lib/intelligence/verdict";
import { TOK } from "@/lib/theme";
import { VerdictHero } from "@/components/views/verdict/VerdictHero";
import { DepartmentRulingCard } from "@/components/views/verdict/DepartmentRulingCard";

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

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Final Verdict · the jury speaks
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Four departments. One ruling.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Each jury department votes on the codebase using the same
          20 deterministic signals you see across the workspace. The
          combined ruling is the bottom-line summary. Every claim
          below is anchored to a signal you can drill into.
        </p>
      </header>

      <VerdictHero verdict={verdict} />

      <section className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Department rulings
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
