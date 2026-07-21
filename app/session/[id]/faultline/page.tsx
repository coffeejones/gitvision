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
import type { RefactorSafetyReport } from "@/lib/refactorSafety";
import { FaultlineSimulator } from "@/components/views/FaultlineSimulator";
import { SignInToUnlock } from "@/components/billing/SignInToUnlock";
import { EmptyPanel } from "@/components/EmptyPanel";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { RollupBar } from "@/components/views/RollupBar";
import { AnchorGlow } from "@/components/views/AnchorGlow";

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

  // The refactor-safety report drives BOTH the high-impact suggestions and the
  // Phase 2 rollup — compute it once (pure function) and derive both from it.
  const safety =
    graph && canSimulate ? computeRefactorSafety(graph, { withTests: true }) : null;
  const suggested = safety ? suggestedFromSafety(safety) : [];

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Faultline"
        title="What breaks if you change this?"
        line="Pick a file and we simulate deleting it — rebuilding the code graph to show what it takes down and which paths have no test to catch the break. Deterministic, cited to real imports and calls. Start with a high-impact target."
        rollup={
          safety && safety.totalFiles > 0 ? (
            <RollupBar
              segments={[
                {
                  count: safety.counts["load-bearing"],
                  color: TOK.rose,
                  label: "load-bearing",
                },
                {
                  count: safety.counts["handle-with-care"],
                  color: TOK.amber,
                  label: "handle with care",
                },
                {
                  count: safety.counts.moderate + safety.counts.safe,
                  color: TOK.textMuted,
                  label: "lower risk",
                },
              ]}
              total={safety.totalFiles}
              trailing={`${safety.totalFiles.toLocaleString()} files with code signal`}
            />
          ) : undefined
        }
      />

      <div id="screenshot-target">
        {!entitled ? (
          <SignInToUnlock
            featureName="the Faultline Simulator"
            redirectTo={`/session/${session.id}/faultline`}
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
          <AnchorGlow>
            <FaultlineSimulator
              sessionId={session.id}
              files={Object.keys(graph!.contentHashes!).sort()}
              suggested={suggested}
            />
          </AnchorGlow>
        )}
      </div>
    </main>
  );
}

/** Seed the picker with the highest-impact files so the first click lands the
 *  dramatic blast, not a leaf file. Reuses the refactor-safety ranking (already
 *  risk-ordered); prefers the two riskiest tiers, falls back to the top overall. */
function suggestedFromSafety(safety: RefactorSafetyReport): string[] {
  const risky = safety.files.filter(
    (f) => f.tier === "load-bearing" || f.tier === "handle-with-care",
  );
  const pool = risky.length > 0 ? risky : safety.files;
  return pool.slice(0, SUGGESTED_COUNT).map((f) => f.file);
}
