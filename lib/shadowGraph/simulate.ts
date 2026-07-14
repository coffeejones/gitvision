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
import { computeBlastRadius } from "@/lib/codeAnalysis/blastRadius";
import { isTestFile } from "@/lib/codeAnalysis/testCoverage";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import type { CodeAnalysisPlugin } from "@/lib/codeAnalysis/types";
import type { AnalysisSnapshot } from "@/lib/types";
import { computeChangeBlast } from "@/lib/changeBlast/compute";
import type { ChangeBlastReport } from "@/lib/changeBlast/types";
import { computeWeakSuite } from "@/lib/weakSuite";
import { deriveTestedFiles } from "@/lib/impact";
import { runPatch, type PatchLimits } from "./runPatch";
import type { FileChange, PatchMode } from "./patch";
import type { ParseLayer } from "./parseCache";

export interface RequiredAction {
  kind:
    | "load-bearing-touched"
    | "update-guarding-tests"
    | "guarding-tests-will-break"
    | "no-guarding-tests"
    | "hollow-tests-added"
    | "new-duplicate";
  severity: "high" | "medium" | "low";
  detail: string;
  evidence: { files?: string[]; numbers?: Record<string, number> };
}

/** A file the change reaches — a dependent of a changed/deleted file, so it's at
 *  risk of breaking. The Faultline canvas draws the shockwave from these; an
 *  agent reads them to know WHICH files to check, not just how many. */
export interface AffectedFile {
  path: string;
  /** Hops from the nearest changed file (1 = a direct importer). */
  hop: number;
  /** A non-test file that no test reaches — a break with no safety net. */
  untested: boolean;
  isTest: boolean;
  /** In a different module/directory than the changed file it depends on. */
  crossModule: boolean;
}

/** The agent conscience (Conscience loop). Classifies the required actions into
 *  what an agent must RESOLVE-OR-JUSTIFY before finishing vs what's merely worth
 *  considering — turning the verdict into an actionable stop/go gate. Blocking is
 *  scoped to genuine "ships an uncaught regression" signals, not "this change is
 *  big" (a load-bearing touch WITH a guarding test is fine). */
export interface ConscienceGate {
  /** true when nothing blocking remains — clear to proceed. false for a
   *  non-patched mode (not evaluated) too, so it's never mistaken for a pass. */
  pass: boolean;
  /** Must be resolved or explicitly justified before finishing. */
  blocking: RequiredAction[];
  /** Worth considering, but not stop-the-line. */
  advisory: RequiredAction[];
  /** One-line imperative for the agent. */
  directive: string;
}

export interface SimulateResult {
  mode: PatchMode;
  /** Present when mode === "patched". */
  report?: ChangeBlastReport;
  requiredActions: RequiredAction[];
  /** The blocking/advisory gate over requiredActions — the agent conscience. */
  gate: ConscienceGate;
  /** The dependent files the change reaches (empty for non-patched modes). */
  affectedFiles: AffectedFile[];
  approximations: string[];
  reason?: string;
  baseMismatch?: string[];
}

/** The required-action kinds that BLOCK: the change would ship a regression
 *  nothing catches. A load-bearing touch alone (with a test) is advisory. */
const BLOCKING_KINDS: ReadonlySet<RequiredAction["kind"]> = new Set([
  "no-guarding-tests",
  "guarding-tests-will-break",
  "hollow-tests-added",
]);

function deriveGate(actions: RequiredAction[]): ConscienceGate {
  const blocking = actions.filter((a) => BLOCKING_KINDS.has(a.kind));
  const advisory = actions.filter((a) => !BLOCKING_KINDS.has(a.kind));
  const pass = blocking.length === 0;
  const directive = pass
    ? advisory.length > 0
      ? "Clear to proceed — no blocking issues; weigh the advisory items."
      : "Clear to proceed — no required actions."
    : `Not done yet: resolve or justify ${blocking.length} blocking issue${blocking.length === 1 ? "" : "s"} (the change ships an uncaught regression), then re-simulate.`;
  return { pass, blocking, advisory, directive };
}

/** The gate for a non-patched mode — never a pass, since nothing was evaluated. */
function notEvaluatedGate(mode: PatchMode): ConscienceGate {
  return {
    pass: false,
    blocking: [],
    advisory: [],
    directive: `Not evaluated (${mode}) — re-analyze the repo for an exact gate.`,
  };
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
  affectedFiles: AffectedFile[],
): RequiredAction[] {
  const actions: RequiredAction[] = [];

  if (report.loadBearingTouched.length > 0) {
    // Are the load-bearing files being DELETED (vs modified)? Their guarding
    // tests then break with them rather than needing an update — reworded below.
    const lbEntries = report.changedFiles.filter((f) =>
      report.loadBearingTouched.includes(f.file),
    );
    const loadBearingRemoved =
      lbEntries.length > 0 && lbEntries.every((f) => f.kind === "removed");
    const breaks = affectedFiles.length;

    actions.push({
      kind: "load-bearing-touched",
      severity: "high",
      detail: `Touches ${report.loadBearingTouched.length} load-bearing wall${report.loadBearingTouched.length === 1 ? "" : "s"}; ${breaks} file${breaks === 1 ? "" : "s"} depend on it directly.`,
      evidence: {
        files: report.loadBearingTouched.slice(0, 10),
        numbers: { walls: report.loadBearingTouched.length, filesBroken: breaks },
      },
    });
    if (report.testsToRun.length === 0) {
      actions.push({
        kind: "no-guarding-tests",
        severity: "high",
        detail: loadBearingRemoved
          ? "No test guards this load-bearing code — nothing would have caught the breakage before you deleted it."
          : "No test file guards the changed load-bearing code — a regression here won't be caught. Add one before merging.",
        evidence: {},
      });
    } else if (loadBearingRemoved) {
      const n = report.testsToRun.length;
      actions.push({
        kind: "guarding-tests-will-break",
        severity: "high",
        detail: `${n} test${n === 1 ? "" : "s"} guard this code — deleting it breaks them too. Remove or rewrite them alongside the change.`,
        evidence: {
          files: report.testsToRun.slice(0, 10),
          numbers: { guardingTests: n },
        },
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

/** The dependent files the change DIRECTLY breaks: the immediate importers/callers
 *  of the changed files in the BASE graph — for a delete, exactly the files that
 *  won't compile once it's gone. Deliberately hop-1 only: hop-2+ files import the
 *  broken file, not the deleted one, so they don't necessarily break. This keeps
 *  the "N files break" count honest AND consistent with the report's direct
 *  fan-in (one number everywhere, no "reach vs break" contradiction). Deduped,
 *  risk-ordered (untested first). */
function computeAffectedFiles(
  baseGraph: CodeGraph,
  changes: FileChange[],
): AffectedFile[] {
  const changedPaths = new Set(changes.map((c) => c.path));
  const tested = deriveTestedFiles(baseGraph);
  const byPath = new Map<string, AffectedFile>();
  for (const c of changes) {
    // Only a file present in the base has dependents (an added path breaks nothing).
    const blast = computeBlastRadius(baseGraph, c.path, { maxHops: 1 });
    for (const e of blast.incoming) {
      if (changedPaths.has(e.filePath)) continue; // a changed file isn't its own casualty
      const isTest = isTestFile(e.filePath);
      const cand: AffectedFile = {
        path: e.filePath,
        hop: e.hop,
        isTest,
        untested: !isTest && !tested.has(e.filePath),
        crossModule: e.crossModule,
      };
      const prev = byPath.get(e.filePath);
      if (!prev || cand.hop < prev.hop) byPath.set(e.filePath, cand);
    }
  }
  return [...byPath.values()].sort(
    (a, b) =>
      a.hop - b.hop ||
      Number(b.untested) - Number(a.untested) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
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
      gate: notEvaluatedGate(patched.mode),
      affectedFiles: [],
      approximations: patched.approximations,
      reason: patched.reason,
      baseMismatch: patched.baseMismatch,
    };
  }

  const baseGraph = baseGraphOf(layer);
  const report = computeChangeBlast(asSnapshot(baseGraph), asSnapshot(patched.graph));
  const affectedFiles = computeAffectedFiles(baseGraph, changes);
  const requiredActions = deriveRequiredActions(
    report,
    baseGraph,
    patched.graph,
    affectedFiles,
  );

  return {
    mode: "patched",
    report,
    requiredActions,
    gate: deriveGate(requiredActions),
    affectedFiles,
    approximations: patched.approximations,
  };
}
