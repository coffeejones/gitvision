// /session/[id]/faultline — the Faultline Simulator (F-1).
//
// "What breaks if you change this?" made interactive: pick a file, we simulate
// deleting it against the cached parse layer (the Shadow-Graph patcher) and show
// the deterministic blast + the required-actions conscience. Plus-gated; demo
// sessions show it ungated so a visitor sees the full surface.

import { notFound } from "next/navigation";
import { Zap } from "lucide-react";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { TOK } from "@/lib/sessionTheme";
import { computeRefactorSafety } from "@/lib/refactorSafety";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import { FaultlineSimulator } from "@/components/views/FaultlineSimulator";
import { UpgradePrompt } from "@/components/billing/UpgradePrompt";
import { EmptyPanel } from "@/components/EmptyPanel";

export const dynamic = "force-dynamic";

const SUGGESTED_COUNT = 6;

export default async function FaultlinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  // Plus-gated (demo sessions bypass so a visitor sees the full surface).
  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  const entitled =
    isDemo ||
    (authSession ? await canAccess(authSession.user.id, "simulate") : false);

  const graph = current.codeGraph;
  // The simulatable file set is exactly the parse layer's — keyed by the same
  // contentHashes the layer was written under. No hashes → an old snapshot the
  // patcher can't key on.
  const canSimulate = !!graph?.contentHashes && Object.keys(graph.contentHashes).length > 0;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Faultline
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.02em", lineHeight: 1.1 }}
        >
          What breaks if you change this?
        </h1>
        <p className="text-sm max-w-2xl leading-relaxed" style={{ color: TOK.textSecondary }}>
          Pick a file and we simulate deleting it — rebuilding the code graph in
          under a second to show exactly what it takes down, how far the shockwave
          reaches, and which paths have no test to catch the break. Deterministic,
          cited to real imports and calls. No AI guesswork.
        </p>
      </header>

      <div id="screenshot-target">
        {!entitled ? (
          <UpgradePrompt
            featureName="the Faultline Simulator"
            requiredTier="standing-docket"
            context="Simulate a change before you make it — and see what it breaks, deterministically."
          />
        ) : !canSimulate ? (
          <EmptyPanel
            icon={<Zap size={22} />}
            title="No code graph to simulate yet"
            body={
              <>
                The simulator splices your change into the analyzed code graph.
                Tiny repos, single-file projects, or snapshots created before code
                analysis shipped land here.
              </>
            }
            hint={
              <>
                Click <strong>Refresh</strong> in the topbar to regenerate the
                graph and enable simulation.
              </>
            }
          />
        ) : (
          <FaultlineSimulator
            sessionId={session.id}
            files={Object.keys(graph!.contentHashes!).sort()}
            suggested={suggestedTargets(graph!)}
          />
        )}
      </div>
    </main>
  );
}

/** Seed the picker with the highest-impact files so the first click lands the
 *  dramatic blast, not a leaf file. Reuses the refactor-safety ranking (already
 *  risk-ordered); prefers the two riskiest tiers, falls back to the top overall. */
function suggestedTargets(graph: CodeGraph): string[] {
  const safety = computeRefactorSafety(graph, { withTests: true });
  const risky = safety.files.filter(
    (f) => f.tier === "load-bearing" || f.tier === "handle-with-care",
  );
  const pool = risky.length > 0 ? risky : safety.files;
  return pool.slice(0, SUGGESTED_COUNT).map((f) => f.file);
}
