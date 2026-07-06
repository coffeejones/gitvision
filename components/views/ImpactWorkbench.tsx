"use client";

// Glue between the ImpactExplorer and the DependencyCanvas on the Imports tab:
// holds the current blast overlay so picking a file (or function) in the
// explorer instantly prunes the canvas to what the change reaches. On wide
// screens the two sit SIDE BY SIDE (explorer left, canvas right) so a selection
// visibly reshapes the graph without scrolling; they stack on narrow screens.
// Both children are client components; the graphs arrive serialized from the
// server page, the empty-state fallback arrives as a server-rendered node.

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

  const canvas = (
    <div id="screenshot-target" className="min-w-0 flex flex-col gap-4">
      {fileGraph && fileGraph.nodes.length > 0 ? (
        <DependencyCanvas
          graph={fileGraph}
          impactHighlight={impactGraph ? highlight : null}
        />
      ) : (
        emptyFallback
      )}
    </div>
  );

  // No impact tool on this snapshot (mega-repo payload cap or no code
  // analysis) — the canvas takes the full width, as before.
  if (!impactGraph) return canvas;

  // Side-by-side on lg+, stacked below. min-w-0 on both cells lets the grid
  // tracks shrink so long mono paths wrap/scroll instead of overflowing.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
      <div className="min-w-0">
        <ImpactExplorer graph={impactGraph} onImpactChange={setHighlight} />
      </div>
      {canvas}
    </div>
  );
}
