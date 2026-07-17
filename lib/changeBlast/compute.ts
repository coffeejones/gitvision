// Change-blast engine (Arc 5, beat 1). Given a base and a head snapshot (two
// refs of the same repo), map the diff onto blast reach: which files changed,
// what tier each sits at, how far it ripples, which load-bearing walls it
// touches, and whether the tests that guard it were updated in the same diff.
//
// Pure over two snapshots (reuses the Arc 1 refactor-safety engine + the code
// graphs), so it's fully unit-testable. The ref resolution + analysis that
// produce the two snapshots live in the route.

import type { AnalysisSnapshot } from "../types";
import type { CodeGraph } from "../codeAnalysis/types";
import {
  buildFanIn,
  computeRefactorSafety,
  SAFETY_TIERS,
  type FileSafety,
  type SafetyTier,
} from "../refactorSafety";
import { isTestFile } from "../codeAnalysis/testCoverage";
import type { ChangeBlastReport, ChangeKind, ChangedFileBlast } from "./types";
import { cmpStr } from "../deterministicSort";

/** A per-file fingerprint: aggregate complexity + the sorted set of its
 *  function body signatures. Two files with the same fingerprint are
 *  behaviourally identical between the two graphs. */
function fileSignatures(cg: CodeGraph): Map<string, string> {
  const fnByFile = new Map<string, string[]>();
  for (const fn of cg.functions) {
    const sig = `${fn.name}\x1F${fn.containerType ?? ""}\x1F${
      fn.bodyHash ?? fn.complexity
    }`;
    const arr = fnByFile.get(fn.filePath);
    if (arr) arr.push(sig);
    else fnByFile.set(fn.filePath, [sig]);
  }

  const out = new Map<string, string>();
  const files = new Set<string>([
    ...Object.keys(cg.fileComplexity),
    ...Object.keys(cg.contentHashes ?? {}),
    ...fnByFile.keys(),
  ]);
  for (const f of files) {
    const fns = (fnByFile.get(f) ?? []).sort();
    // Fold in the raw-content hash so edits the function/complexity signature
    // can't see (regex-fallback languages: no functions, constant complexity)
    // still register as a change. Absent on legacy graphs → falls back to the
    // structural signature only.
    const content = cg.contentHashes?.[f] ?? "";
    out.set(f, `${cg.fileComplexity[f] ?? 0}|${fns.join(",")}|${content}`);
  }
  return out;
}

/** The complete set of files whose content changed between base and head —
 *  not the capped display lists structuralDiff produces. */
function diffChangedFiles(
  baseCg: CodeGraph,
  headCg: CodeGraph,
): Array<{ file: string; kind: ChangeKind }> {
  const base = fileSignatures(baseCg);
  const head = fileSignatures(headCg);
  const changed: Array<{ file: string; kind: ChangeKind }> = [];

  for (const [file, sig] of head) {
    if (!base.has(file)) changed.push({ file, kind: "added" });
    else if (base.get(file) !== sig) changed.push({ file, kind: "modified" });
  }
  for (const file of base.keys()) {
    if (!head.has(file)) changed.push({ file, kind: "removed" });
  }
  return changed;
}

const TIER_ORDER = new Map<SafetyTier, number>(
  SAFETY_TIERS.map((t, i) => [t, i]),
);

function emptyReport(hasGraphs: boolean): ChangeBlastReport {
  return {
    hasGraphs,
    changedFiles: [],
    wallsTouched: [],
    loadBearingTouched: [],
    combinedDependents: 0,
    functionsAdded: 0,
    functionsRemoved: 0,
    testFilesChanged: 0,
    testsToRun: [],
    mappedTestsUpdated: 0,
    verdict: "clear",
    headline: "No code changes detected between the two refs.",
  };
}

export function computeChangeBlast(
  baseSnap: AnalysisSnapshot,
  headSnap: AnalysisSnapshot,
): ChangeBlastReport {
  const baseCg = baseSnap.codeGraph;
  const headCg = headSnap.codeGraph;
  if (!baseCg || !headCg) return emptyReport(false);

  const changed = diffChangedFiles(baseCg, headCg);
  if (changed.length === 0) return emptyReport(true);

  // Safety on both graphs: added/modified files are tiered on head (their state
  // after the change), removed files on base (what depended on them before).
  const headSafety = new Map<string, FileSafety>(
    computeRefactorSafety(headCg, { withTests: true }).files.map((f) => [f.file, f]),
  );
  const baseSafety = new Map<string, FileSafety>(
    computeRefactorSafety(baseCg, { withTests: true }).files.map((f) => [f.file, f]),
  );

  const changedFileSet = new Set(changed.map((c) => c.file));

  const changedFiles: ChangedFileBlast[] = changed.map(({ file, kind }) => {
    const safety = (kind === "removed" ? baseSafety : headSafety).get(file);
    return {
      file,
      kind,
      tier: safety?.tier ?? "safe",
      dependents: safety?.dependents ?? 0,
      untestedDependents: safety?.untestedDependents ?? 0,
      complexity: safety?.complexity ?? 0,
      isTest: isTestFile(file),
      testsToRun: safety?.testsToRun?.map((t) => t.file) ?? [],
    };
  });

  // Risk ranking: production files before tests, then tier, then reach.
  changedFiles.sort(
    (a, b) =>
      Number(a.isTest) - Number(b.isTest) ||
      (TIER_ORDER.get(a.tier) ?? 9) - (TIER_ORDER.get(b.tier) ?? 9) ||
      b.dependents - a.dependents ||
      cmpStr(a.file, b.file),
  );

  const prod = changedFiles.filter((f) => !f.isTest);
  const loadBearingTouched = prod.filter((f) => f.tier === "load-bearing").map((f) => f.file);
  const wallsTouched = prod
    .filter((f) => f.tier === "load-bearing" || f.tier === "handle-with-care")
    .map((f) => f.file);

  // Combined reach = the UNION of the changed prod files' dependent SETS, not
  // the sum of their counts. Summing double-counts a file that depends on
  // several changed files and can exceed the repo's file count — nonsense for a
  // grounded stat. Union each changed file's dependents from the graph it was
  // tiered against (head for added/modified, base for removed).
  const headFanIn = buildFanIn(headCg);
  const baseFanIn = buildFanIn(baseCg);
  const reached = new Set<string>();
  for (const f of prod) {
    const deps = (f.kind === "removed" ? baseFanIn : headFanIn).get(f.file);
    if (deps) for (const d of deps) reached.add(d);
  }
  const combinedDependents = reached.size;
  const testFilesChanged = changedFiles.filter((f) => f.isTest).length;

  const testsToRun = [...new Set(prod.flatMap((f) => f.testsToRun))];
  const mappedTestsUpdated = testsToRun.filter((t) => changedFileSet.has(t)).length;

  const functionsAdded = changed.filter((c) => c.kind === "added").length;
  const functionsRemoved = changed.filter((c) => c.kind === "removed").length;

  // Verdict: touching a load-bearing wall while NONE of the tests that actually
  // guard the changed files were updated is high-risk. `mappedTestsUpdated`
  // (not `testFilesChanged`) is the right gate — a diff can touch an unrelated
  // test file yet leave every guarding test stale. Any wall touched or wide
  // reach warrants review; else clear.
  const verdict: ChangeBlastReport["verdict"] =
    loadBearingTouched.length > 0 && mappedTestsUpdated === 0
      ? "high-risk"
      : wallsTouched.length > 0 || combinedDependents >= 10
        ? "review"
        : "clear";

  const testClause =
    testsToRun.length > 0
      ? `${mappedTestsUpdated}/${testsToRun.length} guarding tests updated`
      : `no mapped tests guard the changed files`;
  const headline = `Touches ${loadBearingTouched.length} load-bearing wall${
    loadBearingTouched.length === 1 ? "" : "s"
  } · ${combinedDependents} dependent file${
    combinedDependents === 1 ? "" : "s"
  } reached · ${testClause}`;

  return {
    hasGraphs: true,
    changedFiles,
    wallsTouched,
    loadBearingTouched,
    combinedDependents,
    functionsAdded,
    functionsRemoved,
    testFilesChanged,
    testsToRun,
    mappedTestsUpdated,
    verdict,
    headline,
  };
}
