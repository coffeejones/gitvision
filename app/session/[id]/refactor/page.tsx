// /session/[id]/refactor — "Can I touch this?" (Arc 1).
//
// The refactor-safety report is computed server-side (pure over the code graph)
// and only the small report is shipped to the client — no big graph payload.

import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { TOK } from "@/lib/sessionTheme";
import { computeRefactorSafety } from "@/lib/refactorSafety";
import { RefactorRadar } from "@/components/views/RefactorRadar";
import { HelpHint } from "@/components/HelpHint";
import { EmptyPanel } from "@/components/EmptyPanel";

export const dynamic = "force-dynamic";

export default async function RefactorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  // The Test Prioritizer is Plus-gated. Demo sessions show it ungated so a
  // visitor sees the full surface; otherwise it needs the entitlement. When
  // not entitled we don't compute it at all, so the data never ships.
  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  const entitled =
    isDemo ||
    (authSession
      ? await canAccess(authSession.user.id, "refactorGuidance")
      : false);

  const report = current.codeGraph
    ? computeRefactorSafety(current.codeGraph, { withTests: entitled })
    : null;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Refactor
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.02em", lineHeight: 1.1 }}
        >
          Can I touch this?
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed inline-flex items-baseline gap-1.5"
          style={{ color: TOK.textSecondary }}
        >
          <span>
            Every file ranked by how safely you can change it — blast reach,
            untested dependents, complexity, and duplication. Named tiers, with
            the evidence shown on every row. No black-box score.
          </span>
          <HelpHint
            anchor="refactor"
            label="How the safety tiers are computed"
          />
        </p>
      </header>

      {report && report.files.length > 0 ? (
        <RefactorRadar
          report={report}
          sessionId={session.id}
          entitled={entitled}
        />
      ) : (
        <EmptyPanel
          icon={<ShieldAlert size={22} />}
          title="No code graph to analyze yet"
          body={
            <>
              The refactor-safety tiers are built from the code graph (functions,
              call edges, complexity). Tiny repos, single-file projects, or
              snapshots created before code analysis shipped will land here.
            </>
          }
          hint={
            <>
              Click <strong>Refresh</strong> in the topbar to regenerate.
            </>
          }
        />
      )}
    </main>
  );
}
