// Compare detected entry points against what the framework says it serves.
import fs from "node:fs";
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";

type Row = { file: string; function: string; route: string; methods: string[] };

(async () => {
  const [oraclePath, root] = process.argv.slice(2);
  const truth: Row[] = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
  const { codeGraph: cg } = await analyzeDirectory(path.resolve(root), ALL_PLUGINS);

  const key = (f: string, n: string) => `${f}::${n}`;
  const detected = new Map<string, string>();
  for (const f of cg.functions) {
    if (f.entryPoint) detected.set(key(f.filePath, f.name), f.entryPoint.route ?? "?");
  }
  // The framework lists one row per ROUTE; a handler with two routes appears
  // twice. Detection is per HANDLER, so compare handler sets.
  const truthHandlers = new Map<string, Row[]>();
  for (const r of truth) {
    const k = key(r.file, r.function);
    truthHandlers.set(k, [...(truthHandlers.get(k) ?? []), r]);
  }

  const found = [...truthHandlers.keys()].filter((k) => detected.has(k));
  const missed = [...truthHandlers.keys()].filter((k) => !detected.has(k));
  const extra = [...detected.keys()].filter((k) => !truthHandlers.has(k));

  const recall = truthHandlers.size ? found.length / truthHandlers.size : 0;
  const prec = detected.size ? found.length / detected.size : 0;
  console.log(`framework serves ${truth.length} routes across ${truthHandlers.size} handlers`);
  console.log(`we detected ${detected.size} entry points`);
  console.log(`  RECALL    ${recall.toFixed(3)}   <- handlers the framework serves that we found`);
  console.log(`  precision ${prec.toFixed(3)}`);
  if (missed.length) {
    console.log(`\n  MISSED (${missed.length}) — reachable in production, invisible to us:`);
    for (const k of missed.slice(0, 12)) {
      const r = truthHandlers.get(k)![0];
      console.log(`     ${k.replace("::", ":")}   route ${r.route}`);
    }
  }
  if (extra.length) {
    console.log(`\n  CLAIMED BUT NOT SERVED (${extra.length}):`);
    for (const k of extra.slice(0, 8)) console.log(`     ${k.replace("::", ":")}   we said ${detected.get(k)}`);
  }
})();
