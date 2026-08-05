// What does the duplicate detector actually see, and what is it hiding?
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { findDuplicateGroups } from "../lib/codeAnalysis/duplicates";

(async () => {
  for (const d of process.argv.slice(2)) {
    const name = path.basename(path.resolve(d));
    const { codeGraph: cg } = await analyzeDirectory(path.resolve(d), ALL_PLUGINS);
    const pairs = (g: { members: unknown[] }[]) =>
      g.reduce((n, x) => n + (x.members.length * (x.members.length - 1)) / 2, 0);
    const shipped = findDuplicateGroups(cg);                                   // floor 5, limit 15
    const all = findDuplicateGroups(cg, { minComplexity: 1, limit: 1e9 });     // everything
    const floored = findDuplicateGroups(cg, { minComplexity: 5, limit: 1e9 }); // floor only
    console.log(`\n${name}  (${cg.functions.length} functions)`);
    console.log(`  shipped defaults      groups ${String(shipped.length).padStart(4)}  pairs ${pairs(shipped)}`);
    console.log(`  floor 5, no limit     groups ${String(floored.length).padStart(4)}  pairs ${pairs(floored)}`);
    console.log(`  floor 1, no limit     groups ${String(all.length).padStart(4)}  pairs ${pairs(all)}`);
    // What is the floor actually hiding? Sample the groups it removes.
    const hiddenByFloor = all.filter((g) => g.maxComplexity < 5);
    console.log(`  --- what the floor hides: ${hiddenByFloor.length} groups ---`);
    for (const g of hiddenByFloor.sort((a, b) => b.members.length - a.members.length).slice(0, 4)) {
      const m = g.members[0];
      console.log(`     x${g.members.length} cx${g.maxComplexity}  ${m.name}()  ${m.filePath}`);
    }
  }
})();
