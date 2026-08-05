import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { findDuplicateGroups } from "../lib/codeAnalysis/duplicates";
(async () => {
  for (const d of process.argv.slice(2)) {
    const { codeGraph: cg } = await analyzeDirectory(path.resolve(d), ALL_PLUGINS);
    const all = findDuplicateGroups(cg, { limit: 1e9 });
    const byName = new Map<string, number[]>();
    for (const g of all) {
      const n = g.members[0].name;
      byName.set(n, [...(byName.get(n) ?? []), g.members.length]);
    }
    const frag = [...byName.entries()].filter(([, v]) => v.length > 1);
    const inFrag = frag.reduce((n, [, v]) => n + v.length, 0);
    console.log(`\n${path.basename(path.resolve(d))}: ${all.length} groups`);
    console.log(`  names split across >1 group: ${frag.length}, accounting for ${inFrag} groups (${Math.round(inFrag*100/all.length)}%)`);
    for (const [n, v] of frag.sort((a,b)=>b[1].length-a[1].length).slice(0,4))
      console.log(`     ${n}() -> ${v.length} groups of sizes ${v.sort((a,b)=>b-a).join(", ")}`);
  }
})();
