// Read the actual source of the top groups. A structural hash says "same
// shape"; only the text says "same logic".
import fs from "node:fs";
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { findDuplicateGroups } from "../lib/codeAnalysis/duplicates";
(async () => {
  const root = path.resolve(process.argv[2]);
  const n = Number(process.argv[3] ?? 3);
  const { codeGraph: cg } = await analyzeDirectory(root, ALL_PLUGINS);
  const groups = findDuplicateGroups(cg);
  for (const g of groups.slice(0, n)) {
    console.log(`\n=== x${g.members.length} cx${g.maxComplexity}  ${g.members[0].name}() ===`);
    for (const m of g.members.slice(0, 2)) {
      const src = fs.readFileSync(path.join(root, m.filePath), "utf8").split("\n");
      console.log(`  --- ${m.filePath}:${m.startRow} ---`);
      for (const l of src.slice(m.startRow - 1, Math.min(m.endRow, m.startRow + 5))) console.log("    " + l.trimEnd().slice(0, 96));
    }
  }
})();
