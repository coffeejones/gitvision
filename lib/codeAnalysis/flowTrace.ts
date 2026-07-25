// Flow traces — "what does this entry point reach?" as a tree.
//
// The compute behind the Flows surface. Two halves:
//   findFlowEntryPoints() — rank the functions worth starting a trace from.
//   computeFlowTrace()    — BFS with parent pointers from one of them.
//
// ─────────────────────────────────────────────────────────────────────────────
// REACH, NOT SEQUENCE. Read this before changing anything here.
//
// A trace says "login REACHES validateCredentials". It must never be presented
// as "login THEN validateCredentials". Two hard reasons:
//
//  1. The graph's own call order is AST pre-order, so a call is recorded BEFORE
//     the calls that are its own arguments — the exact inverse of evaluation
//     order for nested calls. Rendering array order as a sequence on a real
//     login would claim the app logs the user in before checking the password.
//  2. There is no control-flow graph anywhere in the pipeline (decisionPoints
//     only COUNTS branches for cyclomatic complexity). Branches, loops, guards
//     and early returns are invisible, so "what runs" is not derivable.
//
// Children are therefore sorted deterministically by name+file, never by graph
// order, so nothing accidentally reads as a sequence. If a control-flow graph
// ever lands, this is the file that gets to change its mind.
// ─────────────────────────────────────────────────────────────────────────────

import type { CodeGraph } from "./types";
import { isTestFile } from "./testCoverage";
import { cmpStr } from "../deterministicSort";

/** Node id: file + unit separator + function name. Container-qualified names
 *  would be more precise, but call edges resolve to (file, function), so the
 *  id has to match what the edges can address. */
const SEP = "\u001F";
export const flowNodeId = (filePath: string, name: string) => `${filePath}${SEP}${name}`;
export const splitFlowNodeId = (id: string): [string, string] => {
  const i = id.indexOf(SEP);
  return [id.slice(0, i), id.slice(i + 1)];
};

export type FlowEntryKind = "route-like" | "orchestrator" | "root";

export interface FlowEntryPoint {
  id: string;
  filePath: string;
  name: string;
  /** Distinct own-repo functions this one calls. */
  fanOut: number;
  /** Distinct own-repo functions that call this one. 0 = nothing calls it. */
  fanIn: number;
  kind: FlowEntryKind;
  /** Ranking score — higher is a better starting point. Ordering only. */
  score: number;
}

export interface FlowTraceNode {
  id: string;
  filePath: string;
  name: string;
  /** Hops from the entry point. 0 for the root. */
  depth: number;
  /** Parent in the BFS tree; null for the root. A node is reached by many
   *  callers in general — the tree keeps the SHORTEST path, which is why this
   *  is a tree and not the full sub-graph. */
  parentId: string | null;
  complexity: number;
  /** 1-indexed line the function is defined on — the shape the explain endpoint
   *  matches against (marker.startRow + 1). 0 when the definition is unknown
   *  (a call resolved to a file whose function list did not include it). */
  line: number;
  /** Own-repo functions this node calls that are NOT in the tree (already
   *  reached by a shorter path, or cut by the caps). Surfaces "there is more
   *  here" without redrawing the whole graph. */
  elidedChildren: number;
}

export interface FlowTrace {
  rootId: string;
  /** The DRAWN subset — capped so the diagram stays legible. */
  nodes: FlowTraceNode[];
  maxDepth: number;
  /** True when a cap (depth or node count) stopped the walk — the view must
   *  say so rather than implying the tree is the whole story. */
  truncated: boolean;
  /** Distinct functions reachable from the root within `maxDepth`, ignoring the
   *  node cap. The honest headline number: the diagram shows a readable subset,
   *  but "reaches N" must not shrink just because we drew fewer boxes. */
  reachedTotal: number;
}

/** Share of call edges that resolve to a known function. The flow tree can only
 *  be built from resolved edges, so this is the honest ceiling on completeness
 *  and belongs on screen, not in a comment. */
export interface FlowResolution {
  resolvedEdges: number;
  totalEdges: number;
  pct: number;
}

export interface FlowGraphIndex {
  /** callerId → callee ids (own-repo, resolved, self-calls dropped). */
  adjacency: Map<string, Set<string>>;
  /** calleeId → number of distinct own-repo callers. */
  inDegree: Map<string, number>;
  complexity: Map<string, number>;
  /** nodeId → 1-indexed definition line, for the explain endpoint. */
  line: Map<string, number>;
  resolution: FlowResolution;
}

export interface BuildFlowIndexOptions {
  /** Drop edges into or out of test files. Default true: a production flow that
   *  routes through `workspaces.test.ts` is a call-resolution false positive
   *  (same-named helper in a test), and showing it would discredit the whole
   *  diagram. Set false only for a tooling view that wants the raw graph. */
  excludeTests?: boolean;
}

/** Build the resolved function→function index a trace walks. Unresolved edges
 *  (toFile null) and module-scope callers carry no flow and are dropped. */
export function buildFlowIndex(
  cg: CodeGraph,
  opts: BuildFlowIndexOptions = {}
): FlowGraphIndex {
  const excludeTests = opts.excludeTests ?? true;
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const complexity = new Map<string, number>();
  const line = new Map<string, number>();

  for (const fn of cg.functions) {
    if (excludeTests && isTestFile(fn.filePath)) continue;
    const id = flowNodeId(fn.filePath, fn.name);
    complexity.set(id, fn.complexity);
    // 1-indexed: the explain endpoint matches on marker.startRow + 1.
    line.set(id, fn.startRow + 1);
  }

  let resolvedEdges = 0;
  for (const c of cg.calls) {
    if (!c.fromFunction || !c.toFile || !c.toFunction) continue;
    resolvedEdges++;
    if (excludeTests && (isTestFile(c.fromFile) || isTestFile(c.toFile))) continue;
    const from = flowNodeId(c.fromFile, c.fromFunction);
    const to = flowNodeId(c.toFile, c.toFunction);
    if (from === to) continue; // self-recursion adds no story
    let set = adjacency.get(from);
    if (!set) {
      set = new Set();
      adjacency.set(from, set);
    }
    if (!set.has(to)) inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    set.add(to);
  }

  const totalEdges = cg.calls.length;
  return {
    adjacency,
    inDegree,
    complexity,
    line,
    resolution: {
      resolvedEdges,
      totalEdges,
      pct: totalEdges > 0 ? Math.round((resolvedEdges / totalEdges) * 100) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry-point ranking
//
// LANGUAGE-AGNOSTIC BY CONSTRUCTION: one generic pattern set applied uniformly
// to every file, with no per-language or per-framework branch. It is a RANKING
// heuristic, not dispatch — a miss costs a lower score, never a wrong result.
// Measured on 20 stored snapshots: entries matching these patterns produce
// traces with a median of 10 nodes and 64% usable, vs 5 nodes and 41% for
// everything else. A real framework-aware entry-point pass (route tables,
// decorators, exported handlers) would replace this and should; until then this
// buys most of the benefit for none of the architecture.
// ---------------------------------------------------------------------------

const ROUTE_LIKE_PATH =
  /(^|\/)(route|handler|controller|endpoint|main|cmd|server|app|index)\.[a-z]+$|\/(routes?|controllers?|handlers?|api|cmd|pages)\//i;
const ROUTE_LIKE_NAME =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$|^(handle|serve|on|route|main|run|process)[A-Z_]|Handler$|Controller$|^main$/;

/** True when a definition looks like something the outside world triggers. */
export function looksLikeEntryPoint(filePath: string, name: string): boolean {
  return ROUTE_LIKE_PATH.test(filePath) || ROUTE_LIKE_NAME.test(name);
}

export interface FindEntryPointsOptions {
  /** Minimum distinct own-repo callees to count as an orchestrator. Default 3. */
  minFanOut?: number;
  /** Cap the returned list. Default 40. */
  limit?: number;
}

/** Rank the functions worth offering as flow starting points. */
export function findFlowEntryPoints(
  cg: CodeGraph,
  opts: FindEntryPointsOptions = {},
  index?: FlowGraphIndex
): FlowEntryPoint[] {
  const idx = index ?? buildFlowIndex(cg);
  const minFanOut = opts.minFanOut ?? 3;
  const limit = opts.limit ?? 40;

  const out: FlowEntryPoint[] = [];
  for (const [id, callees] of idx.adjacency) {
    const fanOut = callees.size;
    if (fanOut === 0) continue;
    const fanIn = idx.inDegree.get(id) ?? 0;
    const [filePath, name] = splitFlowNodeId(id);
    const routeLike = looksLikeEntryPoint(filePath, name);
    const isRoot = fanIn === 0;
    if (!routeLike && !isRoot && fanOut < minFanOut) continue;

    // Score: route-like dominates (it is the measured signal), then nothing-
    // calls-it, then raw fan-out as a weak tiebreak.
    const kind: FlowEntryKind = routeLike ? "route-like" : isRoot ? "root" : "orchestrator";
    const score = (routeLike ? 1000 : 0) + (isRoot ? 100 : 0) + Math.min(fanOut, 50);
    out.push({ id, filePath, name, fanOut, fanIn, kind, score });
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      cmpStr(a.filePath, b.filePath) ||
      cmpStr(a.name, b.name)
  );
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

export interface FlowTraceOptions {
  /** Hop cap. Default 4 — deep enough for a real hand-off chain, shallow enough
   *  that the drawn tree stays readable. */
  maxDepth?: number;
  /** Cap on DRAWN nodes. Default 14 — past this, fitView shrinks the cards to
   *  mush (the same lesson the Faultline shockwave learned). reachedTotal still
   *  reports the true reach. */
  maxNodes?: number;
  /** Cap on children drawn per node. Default 5 — one parent with 20 children
   *  makes a column taller than the canvas, and fitView then shrinks every card
   *  to mush. The remainder is counted in elidedChildren, so the honesty is
   *  kept while the tree stays readable. */
  maxChildrenPerNode?: number;
}

/** BFS from one entry point, keeping parent pointers, so the result is a
 *  shortest-path tree ready to lay out left-to-right by depth. Returns null
 *  when the target has no resolved outgoing calls (nothing to draw). */
export function computeFlowTrace(
  cg: CodeGraph,
  target: { filePath: string; name: string },
  opts: FlowTraceOptions = {},
  index?: FlowGraphIndex
): FlowTrace | null {
  const idx = index ?? buildFlowIndex(cg);
  const maxDepth = opts.maxDepth ?? 4;
  const maxNodes = opts.maxNodes ?? 14;
  const maxChildren = opts.maxChildrenPerNode ?? 5;
  const rootId = flowNodeId(target.filePath, target.name);
  if (!idx.adjacency.has(rootId)) return null;

  const nodes = new Map<string, FlowTraceNode>();
  const push = (id: string, depth: number, parentId: string | null) => {
    const [filePath, name] = splitFlowNodeId(id);
    nodes.set(id, {
      id,
      filePath,
      name,
      depth,
      parentId,
      complexity: idx.complexity.get(id) ?? 0,
      line: idx.line.get(id) ?? 0,
      elidedChildren: 0,
    });
  };
  push(rootId, 0, null);

  let truncated = false;
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const node = nodes.get(current) as FlowTraceNode;
    if (node.depth >= maxDepth) {
      // Everything below this point is cut, but say how much.
      const kids = idx.adjacency.get(current);
      if (kids && kids.size > 0) {
        node.elidedChildren += kids.size;
        truncated = true;
      }
      continue;
    }
    // Deterministic order — see the REACH-NOT-SEQUENCE note at the top.
    const children = [...(idx.adjacency.get(current) ?? [])].sort((a, b) => {
      const [af, an] = splitFlowNodeId(a);
      const [bf, bn] = splitFlowNodeId(b);
      return cmpStr(an, bn) || cmpStr(af, bf);
    });
    let drawnKids = 0;
    for (const child of children) {
      if (drawnKids >= maxChildren) {
        node.elidedChildren++;
        truncated = true;
        continue;
      }
      if (nodes.has(child)) {
        // Reached by a shorter path already — not an error, just not re-drawn.
        node.elidedChildren++;
        continue;
      }
      if (nodes.size >= maxNodes) {
        node.elidedChildren++;
        truncated = true;
        continue;
      }
      push(child, node.depth + 1, current);
      drawnKids++;
      queue.push(child);
    }
  }

  // Full reachable count within the depth cap, ignoring the node cap. Counted
  // separately so the headline "reaches N" stays true even though the diagram
  // deliberately draws fewer boxes than that.
  const seen = new Set([rootId]);
  const countQueue: Array<[string, number]> = [[rootId, 0]];
  while (countQueue.length > 0) {
    const [id, depth] = countQueue.shift() as [string, number];
    if (depth >= maxDepth) continue;
    for (const child of idx.adjacency.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      countQueue.push([child, depth + 1]);
    }
  }

  const list = [...nodes.values()];
  return {
    rootId,
    nodes: list,
    maxDepth: list.reduce((m, n) => Math.max(m, n.depth), 0),
    truncated,
    reachedTotal: seen.size - 1, // exclude the root itself
  };
}
