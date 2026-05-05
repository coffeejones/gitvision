// Rank functions by their blast radius (v0.58 / A2). Built to power the
// "Touch with care" panel on the session Overview — surface the top N
// functions whose changes ripple the furthest, so visitors discover this
// signal without navigating into the Code tab.
//
// Algorithm (pragmatic two-stage):
//   1. Compute direct (1-hop) incoming caller count for every function
//      with resolved callers. Cheap — single pass over cg.calls.
//   2. Filter candidates to those with at least minDirectIncoming, sort
//      by direct count desc, take top candidatePoolSize. This lets us
//      skip BFS on the long tail of functions that are obviously not
//      hubs.
//   3. For each candidate, BFS incoming + outgoing using the same hop +
//      node caps as computeFunctionBlastRadius. Adjacency map is built
//      once and shared across candidates — way faster than calling
//      computeFunctionBlastRadius per function (which rebuilds adjacency
//      every time).
//   4. Re-rank candidates by transitive incoming count, return top N.
//
// We deliberately exclude functions in test files: a test helper called
// from 30 tests is not a "blast hub" in the architectural sense the panel
// wants to surface. Same exclusion logic as testCoverage.ts (isTestFile).
//
// Pure function over CodeGraph. No I/O. Defensive on missing data —
// returns [] when there are no resolved calls or no candidates pass the
// filter. Language-agnostic: only consumes resolved (toFile != null,
// toFunction != null) call edges.

import type { CodeGraph } from "./types";
import { isTestFile } from "./testCoverage";

export interface RankedBlastFunction {
  filePath: string;
  name: string;
  containerType?: string;
  /** Cyclomatic complexity — useful as a secondary signal: a complex
   *  hub function is worse than a simple one. Surfaced in UI for context. */
  complexity: number;
  /** Direct (1-hop) caller count. The "X functions call this directly"
   *  number — concrete + easy to grok. */
  directIncoming: number;
  /** Transitive (up to maxHops) caller count, capped at maxNodes. The
   *  "X functions break transitively if you change this" number — the
   *  primary blast metric. */
  incomingCount: number;
  /** Transitive (up to maxHops) callee count, capped at maxNodes.
   *  Surfaced for symmetry; less actionable than incoming. */
  outgoingCount: number;
  /** True when the BFS hit the per-direction node cap, so the count
   *  above is a lower bound. UI shows "200+" instead of "200" when set. */
  truncated: boolean;
}

export interface RankBlastOptions {
  /** How many top functions to return. Default 5. */
  limit?: number;
  /** BFS depth. Default 3 — same as computeFunctionBlastRadius. */
  maxHops?: number;
  /** Per-direction node cap. Default 200. */
  maxNodes?: number;
  /** Minimum direct incoming caller count for a function to be ranked.
   *  Default 2 — a function with one or zero callers isn't a "hub" worth
   *  surfacing. */
  minDirectIncoming?: number;
  /** Cap on candidates we BFS. We pre-filter by direct in-degree desc
   *  and take the top this many, then run full BFS on each. Default 50
   *  — comfortable buffer above limit so re-ranking can shuffle order
   *  without missing a winner. */
  candidatePoolSize?: number;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_NODES = 200;
const DEFAULT_MIN_DIRECT_INCOMING = 2;
const DEFAULT_CANDIDATE_POOL_SIZE = 50;

/** ASCII Record Separator — matches the SEP used in blastRadius.ts so
 *  encoded ids share a namespace if both modules ever interoperate. */
const SEP = "\x1E";

function encodeFn(
  filePath: string,
  name: string,
  containerType: string | undefined
): string {
  return `${filePath}${SEP}${name}${SEP}${containerType ?? ""}`;
}

export function rankFunctionsByBlast(
  cg: CodeGraph,
  opts: RankBlastOptions = {}
): RankedBlastFunction[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const minDirectIncoming =
    opts.minDirectIncoming ?? DEFAULT_MIN_DIRECT_INCOMING;
  const candidatePoolSize =
    opts.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE;

  // Test-file classification — same heuristic computeTestCoverage uses.
  // Memoized per filePath since we'll consult it for every function and
  // for both endpoints of every call edge.
  const isTest = new Map<string, boolean>();
  function classify(filePath: string): boolean {
    let v = isTest.get(filePath);
    if (v === undefined) {
      v = isTestFile(filePath);
      isTest.set(filePath, v);
    }
    return v;
  }

  // Map "fileSEPnameSEPcontainer" -> FunctionDef so we can recover
  // display fields (complexity, container) once a winner emerges.
  const fnIndex = new Map<
    string,
    { filePath: string; name: string; containerType?: string; complexity: number }
  >();
  for (const fn of cg.functions) {
    if (classify(fn.filePath)) continue; // never rank test fns themselves
    const id = encodeFn(fn.filePath, fn.name, fn.containerType);
    // Keep the highest-complexity entry on collisions (rare: two fns with
    // identical (file, name, container) — possible with overload-like
    // structures in some languages).
    const existing = fnIndex.get(id);
    if (!existing || fn.complexity > existing.complexity) {
      fnIndex.set(id, {
        filePath: fn.filePath,
        name: fn.name,
        containerType: fn.containerType,
        complexity: fn.complexity,
      });
    }
  }

  // Build adjacency over resolved call edges. Skip edges with test-file
  // endpoints: incoming-from-test inflates utility ranks; outgoing-to-test
  // is meaningless for blast (test deps don't break prod).
  const incomingAdj = new Map<string, Set<string>>();
  const outgoingAdj = new Map<string, Set<string>>();
  const directIncomingCount = new Map<string, number>();

  for (const c of cg.calls) {
    if (c.fromFunction === null) continue;
    if (c.toFile === null || c.toFunction === null) continue;
    if (classify(c.fromFile)) continue;
    if (classify(c.toFile)) continue;

    // We don't have fromContainerType on the edge — but for ranking we
    // only need the toId to count callers. Source-side identity doesn't
    // matter for BFS reachability.
    const fromId = encodeFn(c.fromFile, c.fromFunction, undefined);
    const toId = encodeFn(c.toFile, c.toFunction, c.toContainerType);
    if (fromId === toId) continue; // self-edge

    let outs = outgoingAdj.get(fromId);
    if (!outs) {
      outs = new Set();
      outgoingAdj.set(fromId, outs);
    }
    if (!outs.has(toId)) {
      outs.add(toId);
      let ins = incomingAdj.get(toId);
      if (!ins) {
        ins = new Set();
        incomingAdj.set(toId, ins);
      }
      ins.add(fromId);
      directIncomingCount.set(toId, (directIncomingCount.get(toId) ?? 0) + 1);
    }
  }

  // Pre-filter candidates: in-degree must clear the floor, and the id
  // must point at a known function (we rejected edges into test files,
  // but we might still see functions whose container metadata differs
  // between functions[] and calls[] — drop those gracefully).
  type Candidate = {
    id: string;
    direct: number;
    fnInfo: ReturnType<typeof fnIndex.get>;
  };
  const candidates: Candidate[] = [];
  for (const [id, direct] of directIncomingCount) {
    if (direct < minDirectIncoming) continue;
    const fnInfo = fnIndex.get(id);
    if (!fnInfo) continue;
    candidates.push({ id, direct, fnInfo });
  }
  candidates.sort((a, b) => b.direct - a.direct);
  const pool = candidates.slice(0, candidatePoolSize);

  // BFS each candidate. Reuses adjacencies built above — cheap.
  const ranked: RankedBlastFunction[] = [];
  for (const cand of pool) {
    const inc = bfsCount(cand.id, incomingAdj, maxHops, maxNodes);
    const out = bfsCount(cand.id, outgoingAdj, maxHops, maxNodes);
    ranked.push({
      filePath: cand.fnInfo!.filePath,
      name: cand.fnInfo!.name,
      containerType: cand.fnInfo!.containerType,
      complexity: cand.fnInfo!.complexity,
      directIncoming: cand.direct,
      incomingCount: inc.count,
      outgoingCount: out.count,
      truncated: inc.truncated || out.truncated,
    });
  }

  // Final rank: transitive incoming desc, complexity desc as tie-break,
  // then name asc for stable ordering across runs.
  ranked.sort((a, b) => {
    if (b.incomingCount !== a.incomingCount) {
      return b.incomingCount - a.incomingCount;
    }
    if (b.complexity !== a.complexity) {
      return b.complexity - a.complexity;
    }
    return a.name.localeCompare(b.name);
  });

  return ranked.slice(0, limit);
}

// ------------------- internals -------------------

interface BfsCountResult {
  count: number;
  truncated: boolean;
}

/** Stripped-down BFS that only tallies visited nodes (no entry list).
 *  Same hop + node cap semantics as bfs() in blastRadius.ts. */
function bfsCount(
  start: string,
  adj: Map<string, Set<string>>,
  maxHops: number,
  maxNodes: number
): BfsCountResult {
  const visited = new Set<string>([start]);
  const hopOf = new Map<string, number>();
  hopOf.set(start, 0);
  const queue: string[] = [start];
  let count = 0;
  let truncated = false;

  while (queue.length > 0) {
    const node = queue.shift()!;
    const hop = hopOf.get(node)!;
    if (hop >= maxHops) continue;
    const neighbors = adj.get(node);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (visited.has(n)) continue;
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      visited.add(n);
      hopOf.set(n, hop + 1);
      queue.push(n);
      count++;
    }
    if (truncated) break;
  }

  return { count, truncated };
}
