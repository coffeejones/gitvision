// The verdict layer (Stage 1c). Turns a patched graph into the product output:
// the existing ChangeBlastReport (base-vs-patched blast) plus a machine-readable
// `requiredActions` list — the agent-conscience signal. Every action is grounded
// in a computed delta (walls the diff touches, guarding tests left stale, hollow
// tests introduced, new structural duplication) — no judgment the graph can't back.
//
// Pure over a ParseLayer + changes; both surfaces (MCP simulate_change, the web
// /simulate route) call this. The base graph is rebuilt from the unchanged layer
// so base and patched come from the SAME buildCodeGraph pass — a clean diff.

import { buildCodeGraph } from "@/lib/codeAnalysis/codeGraph";
import { findDuplicateGroups } from "@/lib/codeAnalysis/duplicates";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import type { CodeAnalysisPlugin } from "@/lib/codeAnalysis/types";
import type { AnalysisSnapshot } from "@/lib/types";
import { computeChangeBlast } from "@/lib/changeBlast/compute";
import type { ChangeBlastReport } from "@/lib/changeBlast/types";
import { computeWeakSuite } from "@/lib/weakSuite";
import { runPatch, type PatchLimits } from "./runPatch";
import type { FileChange, PatchMode } from "./patch";
import type { ParseLayer } from "./parseCache";

export interface RequiredAction {
  kind:
    | "load-bearing-touched"
    | "update-guarding-tests"
    | "no-guarding-tests"
    | "hollow-tests-added"
    | "new-duplicate";
  severity: "high" | "medium" | "low";
  detail: string;
  evidence: { files?: string[]; numbers?: Record<string, number> };
}

export interface SimulateResult {
  mode: PatchMode;
  /** Present when mode === "patched". */
  report?: ChangeBlastReport;
  requiredActions: RequiredAction[];
  approximations: string[];
  reason?: string;
  baseMismatch?: string[];
}

const byRelAsc = (a: { rel: string }, b: { rel: string }) =>
  a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;

/** Rebuild the base CodeGraph from the unchanged parse layer (same code path as
 *  patch(), so the base-vs-patched diff is clean). */
function baseGraphOf(layer: ParseLayer): CodeGraph {
  const files = [...layer.files].sort(byRelAsc);
  const g = buildCodeGraph({ parsedFiles: files, pluginByFile: layer.pluginByFile });
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(layer.contentHashes).sort()) sorted[k] = layer.contentHashes[k];
  g.contentHashes = sorted;
  return g;
}

const asSnapshot = (codeGraph: CodeGraph) => ({ codeGraph }) as AnalysisSnapshot;

function dupMemberCount(g: CodeGraph): number {
  return findDuplicateGroups(g, { limit: 1_000_000 }).reduce(
    (n, grp) => n + grp.members.length,
    0,
  );
}

/** Derive the agent-actionable list from the report + base/patched deltas. */
function deriveRequiredActions(
  report: ChangeBlastReport,
  baseGraph: CodeGraph,
  patchedGraph: CodeGraph,
): RequiredAction[] {
  const actions: RequiredAction[] = [];

  if (report.loadBearingTouched.length > 0) {
    actions.push({
      kind: "load-bearing-touched",
      severity: "high",
      detail: `Touches ${report.loadBearingTouched.length} load-bearing wall${report.loadBearingTouched.length === 1 ? "" : "s"}; the change reaches ${report.combinedDependents} dependent file${report.combinedDependents === 1 ? "" : "s"}.`,
      evidence: {
        files: report.loadBearingTouched.slice(0, 10),
        numbers: { walls: report.loadBearingTouched.length, dependentsReached: report.combinedDependents },
      },
    });
    if (report.testsToRun.length === 0) {
      actions.push({
        kind: "no-guarding-tests",
        severity: "high",
        detail: "No test file guards the changed load-bearing code — a regression here won't be caught. Add one before merging.",
        evidence: {},
      });
    } else if (report.mappedTestsUpdated < report.testsToRun.length) {
      actions.push({
        kind: "update-guarding-tests",
        severity: "high",
        detail: `${report.mappedTestsUpdated} of ${report.testsToRun.length} guarding tests were updated. Update the rest so the change stays covered.`,
        evidence: {
          files: report.testsToRun.slice(0, 10),
          numbers: { updated: report.mappedTestsUpdated, total: report.testsToRun.length },
        },
      });
    }
  }

  const baseHollow = computeWeakSuite(baseGraph)?.totals.smokeOnlyCases ?? 0;
  const patchedHollow = computeWeakSuite(patchedGraph)?.totals.smokeOnlyCases ?? 0;
  const hollowDelta = patchedHollow - baseHollow;
  if (hollowDelta > 0) {
    actions.push({
      kind: "hollow-tests-added",
      severity: "medium",
      detail: `${hollowDelta} new test case${hollowDelta === 1 ? "" : "s"} execute code but assert nothing meaningful — coverage that wouldn't catch a regression.`,
      evidence: { numbers: { newSmokeOnlyCases: hollowDelta } },
    });
  }

  const dupDelta = dupMemberCount(patchedGraph) - dupMemberCount(baseGraph);
  if (dupDelta > 0) {
    actions.push({
      kind: "new-duplicate",
      severity: "low",
      detail: `${dupDelta} function${dupDelta === 1 ? "" : "s"} now structurally duplicate existing code — consider extracting a shared helper.`,
      evidence: { numbers: { newDuplicatedFunctions: dupDelta } },
    });
  }

  return actions;
}

/** Simulate a change against a cached parse layer and return the blast verdict +
 *  required actions (or a declared non-patched mode). */
export async function simulateChange(
  layer: ParseLayer,
  changes: FileChange[],
  plugins: CodeAnalysisPlugin[],
  limits?: PatchLimits,
): Promise<SimulateResult> {
  const patched = await runPatch(layer, changes, plugins, limits);
  if (patched.mode !== "patched" || !patched.graph) {
    return {
      mode: patched.mode,
      requiredActions: [],
      approximations: patched.approximations,
      reason: patched.reason,
      baseMismatch: patched.baseMismatch,
    };
  }

  const baseGraph = baseGraphOf(layer);
  const report = computeChangeBlast(asSnapshot(baseGraph), asSnapshot(patched.graph));
  const requiredActions = deriveRequiredActions(report, baseGraph, patched.graph);

  return { mode: "patched", report, requiredActions, approximations: patched.approximations };
}
