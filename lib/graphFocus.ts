import { cmpStr } from "./deterministicSort";
// Graph-topology helper for the dependency canvas's focus mode.
//
// When a file is clicked, the canvas prunes to that file's N-hop neighborhood
// instead of dimming the whole graph — a global ~400-node layered DAG is
// unreadable, but the 5-40 nodes that actually touch the clicked file are a
// clean, screenshot-worthy local story. This computes that neighborhood.
//
// Pure and domain-neutral: it walks any `{ from, to }` edge list, so it has no
// dependency on FileGraph, the code graph, or any server module — safe to run
// client-side on every selection, like the blast-radius engine it sits beside.

export type FocusDirection = "in" | "out" | "both";

export interface Neighborhood {
  /** Every node within `depth` hops of the root (root included). */
  ids: Set<string>;
  /** node path → minimum hop distance from the root (root = 0). */
  hops: Map<string, number>;
  /** Reachable nodes dropped by the `maxNodes` cap (farthest first). */
  dropped: number;
}

export interface NeighborhoodOptions {
  /** Max hops out from the root (clamped to >= 0). */
  depth: number;
  /** Follow incoming edges ("who depends on the root"), outgoing ("what the
   *  root depends on"), or both. */
  direction: FocusDirection;
  /** Cap on total nodes kept, nearest hops first. The root always survives;
   *  nodes beyond the cap are dropped and counted in `dropped`. */
  maxNodes: number;
}

/** BFS the `depth`-hop neighborhood of `root` over `edges` in the requested
 *  direction(s), recording each node's minimum hop distance and capping the
 *  result to `maxNodes` (nearest hops first, root always kept). */
export function neighborhood(
  edges: ReadonlyArray<{ from: string; to: string }>,
  root: string,
  { depth, direction, maxNodes }: NeighborhoodOptions
): Neighborhood {
  const wantOut = direction === "out" || direction === "both";
  const wantIn = direction === "in" || direction === "both";

  // Adjacency for the requested direction(s), built once. Self-edges carry no
  // neighborhood signal (a file importing itself) so they're skipped.
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (wantOut) {
      const a = outAdj.get(e.from);
      if (a) a.push(e.to);
      else outAdj.set(e.from, [e.to]);
    }
    if (wantIn) {
      const a = inAdj.get(e.to);
      if (a) a.push(e.from);
      else inAdj.set(e.to, [e.from]);
    }
  }

  // Level-order BFS so `hops` records the *minimum* distance to each node even
  // when it's reachable by several paths.
  const hops = new Map<string, number>([[root, 0]]);
  const maxDepth = Math.max(0, depth);
  let frontier = [root];
  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      const step = (nb: string) => {
        if (!hops.has(nb)) {
          hops.set(nb, d);
          next.push(nb);
        }
      };
      if (wantOut) for (const nb of outAdj.get(node) ?? []) step(nb);
      if (wantIn) for (const nb of inAdj.get(node) ?? []) step(nb);
    }
    frontier = next;
  }

  // Cap: keep the nearest `maxNodes` nodes, ties broken by path for a stable
  // result. The root (hop 0) always sorts first, so it's never dropped.
  const cap = Math.max(1, maxNodes);
  if (hops.size <= cap) {
    return { ids: new Set(hops.keys()), hops, dropped: 0 };
  }
  const sorted = [...hops.entries()].sort(
    (a, b) => a[1] - b[1] || cmpStr(a[0], b[0])
  );
  const kept = new Map<string, number>();
  let dropped = 0;
  for (const [id, h] of sorted) {
    if (kept.size < cap) kept.set(id, h);
    else dropped++;
  }
  return { ids: new Set(kept.keys()), hops: kept, dropped };
}
