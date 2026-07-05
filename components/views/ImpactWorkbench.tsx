"use client";

// Glue between the ImpactExplorer and the DependencyCanvas on the Imports tab:
// holds the current blast overlay so picking a file (or function) in the
// explorer instantly dims everything the change doesn't reach in the canvas
// below. Both children are client components; the graphs arrive serialized
// from the server page, the empty-state fallback arrives as a server-rendered
// node.

import { useState, type ReactNode } from "react";
import { DependencyCanvas } from "@/components/views/DependencyCanvas";
import { ImpactExplorer } from "@/components/views/ImpactExplorer";
import type { ImpactHighlight } from "@/lib/impact";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import type { FileGraph } from "@/lib/types";

export function ImpactWorkbench({
  impactGraph,
  fileGraph,
  emptyFallback,
}: {
  /** Trimmed code graph for the impact tool; null hides the explorer
   *  (mega-repo payload cap or no code analysis on this snapshot). */
  impactGraph: CodeGraph | null;
  /** File graph for the canvas; null/empty renders the fallback. */
  fileGraph: FileGraph | null;
  /** Server-rendered empty state shown when there's no file graph. */
  emptyFallback: ReactNode;
}) {
  const [highlight, setHighlight] = useState<ImpactHighlight | null>(null);

  return (
    <>
      {impactGraph && (
        <ImpactExplorer graph={impactGraph} onImpactChange={setHighlight} />
      )}

      <div id="screenshot-target" className="flex flex-col gap-4">
        {fileGraph && fileGraph.nodes.length > 0 ? (
          <DependencyCanvas
            graph={fileGraph}
            impactHighlight={impactGraph ? highlight : null}
          />
        ) : (
          emptyFallback
        )}
      </div>
    </>
  );
}
