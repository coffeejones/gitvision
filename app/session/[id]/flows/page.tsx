// /session/[id]/flows — "How does this work?"
//
// Pick something the outside world triggers (an API route, a handler, a main)
// and see what it reaches, drawn left-to-right by distance. The orientation
// surface: read the flow before you take anything apart.
//
// Traces are pure and small, so they're computed here and passed down — the
// client never receives the full call graph, and switching entry points is
// instant with no API round-trip.
//
// LANGUAGE NOTE: the entry-point ranking is one generic path/name pattern set
// applied to every file (see lib/codeAnalysis/flowTrace.ts). No per-language or
// per-framework branch lives here or there.

import { notFound } from "next/navigation";
import { Route } from "lucide-react";
import { getSession } from "@/lib/storage";
import {
  buildFlowIndex,
  computeFlowTrace,
  findFlowEntryPoints,
} from "@/lib/codeAnalysis/flowTrace";
import { EmptyPanel } from "@/components/EmptyPanel";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { AnchorGlow } from "@/components/views/AnchorGlow";
import { FlowsView, type FlowEntry } from "@/components/views/FlowsView";

export const dynamic = "force-dynamic";

/** How many entry points to offer. Each carries a precomputed trace, so this
 *  bounds the payload; 18 covers a repo's routes without shipping the graph. */
const ENTRY_LIMIT = 18;

export default async function FlowsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  const graph = current.codeGraph;
  const index = graph ? buildFlowIndex(graph) : null;
  const entries = graph && index ? findFlowEntryPoints(graph, { limit: ENTRY_LIMIT }, index) : [];

  const flows: FlowEntry[] = [];
  if (graph && index) {
    for (const entry of entries) {
      const trace = computeFlowTrace(graph, entry, {}, index);
      // A one-node "tree" is a dead end, not a flow — don't offer it.
      if (trace && trace.nodes.length > 1) flows.push({ entry, trace });
    }
    // Order by how much STORY each one actually tells. Fan-out ranked the
    // candidates, but a trace's real size is the better signal once computed —
    // it's what decides whether the first click lands on something worth
    // looking at. Entry-point-shaped starts still win ties over coordinators.
    flows.sort(
      (a, b) =>
        Number(b.entry.kind === "route-like") - Number(a.entry.kind === "route-like") ||
        b.trace.reachedTotal - a.trace.reachedTotal ||
        b.trace.maxDepth - a.trace.maxDepth
    );
  }

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Flows"
        title="How does this work?"
        line="Pick something the outside world triggers — an API route, a handler, a main — and see what it reaches. Every arrow is a real call found in the code, and the columns are how far away something is, not the order it happens."
      />

      <div id="screenshot-target">
        {!graph ? (
          <EmptyPanel
            icon={<Route size={22} />}
            title="No code graph to trace yet"
            body={
              <>
                Flows are drawn from the analyzed call graph
                {current.codeGraphSkipReason ? ` — ${current.codeGraphSkipReason}` : ""}. Snapshots
                created before code analysis shipped, and repos with no parsed source, land here.
              </>
            }
            hint={
              <>
                Click <strong>Refresh</strong> in the topbar to regenerate the graph.
              </>
            }
          />
        ) : flows.length === 0 ? (
          <EmptyPanel
            icon={<Route size={22} />}
            title="No traceable flows in this repo"
            body={
              <>
                Nothing in this snapshot both looks like an entry point and has calls that resolve
                to functions we parsed. That happens on small repos, on libraries whose public
                surface is one call deep, and in languages where the analyzer reads imports but not
                call graphs.
              </>
            }
          />
        ) : (
          <AnchorGlow>
            <FlowsView sessionId={session.id} flows={flows} resolution={index!.resolution} />
          </AnchorGlow>
        )}
      </div>
    </main>
  );
}
