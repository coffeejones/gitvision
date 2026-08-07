// computeLayers memoises through a cycle guard that returns 0 for the edge
// closing a cycle. WHICH node gets that 0 depends on the order `paths` is
// walked — so on a graph with import cycles the depth is order-dependent.
// This reimplements the algorithm verbatim (it is not exported) and feeds it
// the same graph in different orders.
import fs from "node:fs";

function computeLayers(paths: string[], edges: { from: string; to: string }[]) {
  const incoming = new Map<string, Set<string>>();
  for (const p of paths) incoming.set(p, new Set());
  for (const e of edges) incoming.get(e.to)?.add(e.from);
  const layer = new Map<string, number>();
  function compute(p: string, visiting: Set<string>): number {
    const cached = layer.get(p);
    if (cached !== undefined) return cached;
    if (visiting.has(p)) return 0;
    visiting.add(p);
    let l = 0;
    for (const src of incoming.get(p) ?? []) l = Math.max(l, compute(src, visiting) + 1);
    visiting.delete(p);
    layer.set(p, l);
    return l;
  }
  for (const p of paths) compute(p, new Set());
  return layer;
}

const shuffle = <T,>(a: T[], seed: number) => {
  const out = [...a]; let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const fg = JSON.parse(fs.readFileSync(process.argv[2], "utf-8")).snapshots.at(-1).fileGraph;
const paths: string[] = fg.nodes.map((n: { path: string }) => n.path);
const edges = fg.edges as { from: string; to: string }[];
const maxima = new Map<number, number>();
const N = Number(process.env.N ?? 200);
for (let i = 0; i < N; i++) {
  const l = computeLayers(shuffle(paths, i + 1), edges);
  const max = Math.max(0, ...l.values());
  maxima.set(max, (maxima.get(max) ?? 0) + 1);
}
console.log(`  ${paths.length} files, ${edges.length} edges, ${N} orderings`);
console.log(`  deepest chain reported:`);
for (const [d, n] of [...maxima].sort((a, b) => a[0] - b[0])) console.log(`     ${String(n).padStart(4)}x  ${d} levels`);
