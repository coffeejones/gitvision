// Test-to-code coverage mapping (v0.29). Pure function over CodeGraph —
// runs client-side fast enough that the UI can recompute on every
// snapshot change without a server round-trip.
//
// Algorithm (simple, direct calls only):
//   1. Mark each file as "test" or "prod" via path / name conventions
//      across the languages we support.
//   2. For every resolved CallEdge where fromFile is a test file and
//      toFile is a prod file, mark (toFile, toFunction, toContainerType)
//      as "covered".
//   3. Aggregate per prod file: how many of its functions are covered?
//   4. Surface untested hotspots: prod functions with zero test callers,
//      sorted by complexity descending, capped at a reasonable list size.
//
// Transitive coverage is intentionally NOT counted — a function 3 hops
// removed from a test would otherwise read as "tested" when it really
// only shares an import chain. Direct-call evidence is the cleanest
// signal we can give without false positives.

import type { CodeGraph, FunctionDef } from "./types";

export interface FileCoverage {
  filePath: string;
  /** Functions in this file with at least one direct test caller. */
  tested: number;
  /** Total functions in this file. */
  total: number;
  /** Distinct test files that call into this file's functions. Useful for
   *  showing "tested by 3 test files" hint without listing them all. */
  testers: number;
}

export interface UntestedHotspot {
  filePath: string;
  name: string;
  containerType?: string;
  complexity: number;
}

export interface TestCoverage {
  /** Per-file coverage stats. Only includes prod files (test files
   *  themselves are excluded). Indexed by repo-rel path. */
  byFile: Map<string, FileCoverage>;
  /** Production functions with zero direct test callers, sorted by
   *  complexity descending. Capped to the top N — extracted via the
   *  `untestedHotspotsLimit` option (default 10). */
  untestedHotspots: UntestedHotspot[];
  /** Aggregate stats useful for headline-style summaries. */
  totals: {
    /** Total prod files (excludes test files). */
    prodFiles: number;
    /** Prod files with at least one tested function. */
    prodFilesWithCoverage: number;
    /** Total prod functions across all prod files. */
    prodFunctions: number;
    /** Prod functions with at least one direct test caller. */
    testedProdFunctions: number;
    /** Total test files we identified via the heuristic. */
    testFiles: number;
  };
}

export interface ComputeTestCoverageOptions {
  /** Cap for the untestedHotspots list. Default 10 — enough for a
   *  panel, short enough to stay scannable. */
  untestedHotspotsLimit?: number;
}

// ------------------- Test-file detection -------------------

/** Path segments that indicate a directory of tests. Matched as
 *  forward-slash-separated segments anywhere in the path so subfolder
 *  layouts (`src/foo/__tests__/bar.ts`, `tests/integration/baz.py`)
 *  all qualify. Lowercase comparison; the input is lower-cased once. */
const TEST_DIR_SEGMENTS: readonly string[] = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/spec/",
  "/specs/",
  "/__specs__/",
];

/** Filename-suffix patterns that mark a file as a test, irrespective of
 *  directory. Important for languages where tests live alongside source
 *  (Go, sometimes Python). Matched against the lowercase basename. */
const TEST_SUFFIXES: readonly string[] = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.jsx",
  ".test.mjs",
  ".test.cjs",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.jsx",
  "_test.go",
  "_test.py",
  "_spec.py",
  "_test.rb",
  "_spec.rb",
  "test.java",
  "tests.java",
  "test.kt",
  "tests.kt",
  "test.cs",
  "tests.cs",
  "test.php",
  "tests.php",
];

/** Filename prefixes for languages where tests are denoted by a leading
 *  marker. Python's `test_*.py` is the canonical example. */
const TEST_PREFIXES: readonly string[] = ["test_"];

/** Heuristic — is this file a test file? Path is repo-rel posix-style.
 *  Pure function, exported so the UI can mark test files in lists too
 *  (e.g. excluding them from "heaviest files" if we want to). */
export function isTestFile(filePath: string): boolean {
  if (!filePath) return false;
  // Normalize to lowercase + forward slashes for a single comparison
  // pass. Wrap the path with leading and trailing slashes so segment
  // matches don't have to special-case the start/end.
  const normalized = `/${filePath.toLowerCase()}/`;
  for (const seg of TEST_DIR_SEGMENTS) {
    if (normalized.includes(seg)) return true;
  }
  // Basename heuristics
  const slashIdx = filePath.lastIndexOf("/");
  const basename = (
    slashIdx < 0 ? filePath : filePath.slice(slashIdx + 1)
  ).toLowerCase();
  for (const suffix of TEST_SUFFIXES) {
    if (basename.endsWith(suffix)) return true;
  }
  for (const prefix of TEST_PREFIXES) {
    if (basename.startsWith(prefix)) return true;
  }
  return false;
}

// ------------------- Coverage computation -------------------

/** Encode a (file, name, container) tuple as a key into our coverage
 *  Sets/Maps. Same separator (\x1E ASCII RS) as blastRadius.ts so the
 *  encoding can't collide with any path / identifier / type name. */
function fnKey(
  filePath: string,
  name: string,
  containerType: string | undefined
): string {
  return `${filePath}${name}${containerType ?? ""}`;
}

export function computeTestCoverage(
  codeGraph: CodeGraph,
  opts: ComputeTestCoverageOptions = {}
): TestCoverage {
  const limit = opts.untestedHotspotsLimit ?? 10;

  // Step 1: classify every file we know about. We have to consult both
  // codeGraph.functions AND codeGraph.calls because a test file's
  // own function defs sometimes don't make it into cg.functions on
  // small fixtures, but its outgoing calls (fromFile) still do — we
  // can't classify a caller as "test" if we never index its path.
  const isTest = new Map<string, boolean>();
  function classify(filePath: string) {
    if (!isTest.has(filePath)) {
      isTest.set(filePath, isTestFile(filePath));
    }
  }
  for (const fn of codeGraph.functions) classify(fn.filePath);
  for (const c of codeGraph.calls) {
    classify(c.fromFile);
    if (c.toFile) classify(c.toFile);
  }

  // Step 2: walk resolved call edges. For every edge where fromFile is
  // a test file and toFile is a prod file, mark the target function as
  // covered. We also keep track of WHICH test files cover each prod
  // file so the UI can surface "tested by N test files" hints.
  const coveredFns = new Set<string>();
  const testersByFile = new Map<string, Set<string>>();
  for (const c of codeGraph.calls) {
    if (!c.toFile || !c.toFunction) continue;
    const fromIsTest = isTest.get(c.fromFile);
    if (!fromIsTest) continue;
    const toIsTest = isTest.get(c.toFile);
    // Don't count test-to-test calls as coverage — a test calling a
    // test helper isn't "production coverage".
    if (toIsTest) continue;
    coveredFns.add(fnKey(c.toFile, c.toFunction, c.toContainerType));
    let testers = testersByFile.get(c.toFile);
    if (!testers) {
      testers = new Set();
      testersByFile.set(c.toFile, testers);
    }
    testers.add(c.fromFile);
  }

  // Step 3: aggregate per prod file. We walk codeGraph.functions and
  // bucket by file, counting how many functions per file have a hit
  // in coveredFns.
  const fnsByFile = new Map<string, FunctionDef[]>();
  for (const fn of codeGraph.functions) {
    const arr = fnsByFile.get(fn.filePath) ?? [];
    arr.push(fn);
    fnsByFile.set(fn.filePath, arr);
  }

  const byFile = new Map<string, FileCoverage>();
  let prodFiles = 0;
  let prodFilesWithCoverage = 0;
  let prodFunctions = 0;
  let testedProdFunctions = 0;
  for (const [filePath, fns] of fnsByFile) {
    if (isTest.get(filePath)) continue; // skip test files in the byFile map
    prodFiles++;
    const total = fns.length;
    let tested = 0;
    for (const fn of fns) {
      if (coveredFns.has(fnKey(fn.filePath, fn.name, fn.containerType))) {
        tested++;
      }
    }
    prodFunctions += total;
    testedProdFunctions += tested;
    if (tested > 0) prodFilesWithCoverage++;
    byFile.set(filePath, {
      filePath,
      tested,
      total,
      testers: testersByFile.get(filePath)?.size ?? 0,
    });
  }

  // Step 4: surface untested hotspots. Walk all prod functions, drop
  // the ones with at least one test caller, sort the rest by complexity
  // descending, take top N.
  const untestedHotspots: UntestedHotspot[] = [];
  for (const fn of codeGraph.functions) {
    if (isTest.get(fn.filePath)) continue;
    if (coveredFns.has(fnKey(fn.filePath, fn.name, fn.containerType))) continue;
    untestedHotspots.push({
      filePath: fn.filePath,
      name: fn.name,
      containerType: fn.containerType,
      complexity: fn.complexity,
    });
  }
  untestedHotspots.sort((a, b) => b.complexity - a.complexity);

  // Count test files explicitly so the totals reflect what isTestFile
  // matched, even on files with no functions extracted.
  let testFiles = 0;
  for (const v of isTest.values()) {
    if (v) testFiles++;
  }

  return {
    byFile,
    untestedHotspots: untestedHotspots.slice(0, limit),
    totals: {
      prodFiles,
      prodFilesWithCoverage,
      prodFunctions,
      testedProdFunctions,
      testFiles,
    },
  };
}
