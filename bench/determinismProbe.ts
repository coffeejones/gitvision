// Same graph, different node order. A deterministic detector must not care.
import fs from "node:fs";
import { extractHealthSignals } from "../lib/signals";

const shuffle = <T,>(a: T[], seed: number): T[] => {
  const out = [...a];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

(async () => {
  const file = process.argv[2];
  const base = JSON.parse(fs.readFileSync(file, "utf-8")).snapshots.at(-1);
  const counts = new Map<string, number>();
  const layers = new Set<number>();
  const N = Number(process.env.N ?? 60);
  for (let i = 0; i < N; i++) {
    const snap = {
      ...base,
      fileGraph: base.fileGraph
        ? { ...base.fileGraph, nodes: shuffle(base.fileGraph.nodes, i + 1) }
        : base.fileGraph,
    };
    const r = extractHealthSignals(snap) as unknown as Record<string, { id: string; severity: string; detail?: string }[]>;
    const all = [...(r.working ?? []), ...(r.needsWork ?? []), ...(r.questions ?? [])];
    const deep = all.find((s) => s.id === "deep-dependency-chains");
    const bucket = r.needsWork?.some((s) => s.id === "deep-dependency-chains") ? "needsWork"
      : r.questions?.some((s) => s.id === "deep-dependency-chains") ? "questions"
      : r.working?.some((s) => s.id === "deep-dependency-chains") ? "working" : "absent";
    const key = deep ? `${deep.severity} (${bucket})` : "(no signal)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const m = deep?.detail?.match(/(\d+) levels?/);
    if (m) layers.add(Number(m[1]));
  }
  console.log(`  ${N} permutations of the SAME graph, node order only:`);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}x  ${k}`);
  console.log(`     distinct depths reported: ${[...layers].sort((a, b) => a - b).join(", ") || "n/a"}`);
})();
