// /session/[id]/code — Code tab as its own route (v0.42).
//
// The route ALSO honors the v0.37 deep-link sub-params (?file, ?fn,
// ?container, ?focus, ?group). CodePanel reads them itself via
// useSearchParams; we don't need to thread them through here.

import { notFound } from "next/navigation";
import { getSessionCached } from "@/lib/sessionCache";
import { CodePanel } from "@/components/views/CodePanel";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { RollupCounts } from "@/components/views/RollupBar";
import { computeCallResolution } from "@/lib/codeAnalysis/callResolution";
import {
  findDuplicateGroups,
  summarizeDuplicates,
} from "@/lib/codeAnalysis/duplicates";
import { computeTestCoverage } from "@/lib/codeAnalysis/testCoverage";

export const dynamic = "force-dynamic";

export default async function CodeRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionCached(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  // Phase 2 rollup — a count line reusing the same values CodePanel's stat tiles
  // already compute (functions, call-resolution rate, duplicate groups, and a
  // guarded coverage figure). These aren't slices of one whole, so it's a count
  // line, not a bar. Zero new compute beyond the pure functions below.
  const cg = current.codeGraph;
  let codeRollupParts: Array<string | false | null | undefined> = [];
  if (cg) {
    const resolvedPct = Math.round(computeCallResolution(cg).rate * 100);
    const dupGroups = summarizeDuplicates(findDuplicateGroups(cg)).totalGroups;
    const cov = computeTestCoverage(cg).totals;
    const covClause =
      cov.testFiles > 0 && cov.prodFunctions > 0
        ? `${Math.round(
            (cov.testedProdFunctions / cov.prodFunctions) * 100,
          )}% of prod functions have a direct test caller`
        : cov.testFiles === 0
          ? "no test files identified"
          : null;
    codeRollupParts = [
      covClause,
      `${cg.functions.length.toLocaleString()} functions`,
      `${resolvedPct}% of call sites resolved`,
      `${dupGroups.toLocaleString()} duplicate group${dupGroups === 1 ? "" : "s"}`,
    ];
  }

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Code"
        title="Blast radius, hotspots, duplicates."
        line="Pick a heavy file or function to see what a change would touch — incoming is what depends on it, outgoing is what it depends on, hops capped at 3 so central files don’t show “everything.” Start with the heaviest file below."
        rollup={
          cg ? <RollupCounts parts={codeRollupParts} /> : undefined
        }
      />
      <div id="screenshot-target" className="flex flex-col gap-4">
        <CodePanel snapshot={current} />
      </div>
    </main>
  );
}
