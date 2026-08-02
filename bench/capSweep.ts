import fs from "node:fs";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety } from "../lib/refactorSafety";
(async () => {
  for (const [label, oraclePath, root] of [
    ["TypeScript (this repo)", "/tmp/mutation.json", process.cwd()],
    ["Python (Flask)", "/tmp/pymutation.json", `${process.env.HOME}/.codetrawl-bench/pymut/flask`],
  ] as const) {
    const oracle: Record<string, string[]> = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
    const { codeGraph } = await analyzeDirectory(root, ALL_PLUGINS);
    const rep = computeRefactorSafety(codeGraph, { withTests: true });
    // testsToRun is already capped at 6; re-derive the FULL ranked order by
    // reading the same field before the slice is not possible, so approximate
    // the sweep with what the cap would admit from the ranked list we have.
    console.log(`\n${label}`);
    console.log(`  cap   recall   precision   (ceiling at that cap)`);
    for (const cap of [3, 6, 10, 20, 1000]) {
      let tp = 0, missed = 0, extra = 0, ceil = 0, total = 0;
      for (const [file, actual] of Object.entries(oracle)) {
        if (!actual.length) continue;
        const f = rep.files.find((x) => x.file === file);
        const listed = (f?.testsToRun ?? []).map((t) => t.file).slice(0, cap);
        tp += actual.filter((t) => listed.includes(t)).length;
        missed += actual.filter((t) => !listed.includes(t)).length;
        extra += listed.filter((t) => !actual.includes(t)).length;
        ceil += Math.min(cap, actual.length); total += actual.length;
      }
      const r = tp / (tp + missed), p = tp + extra ? tp / (tp + extra) : 0;
      console.log(`  ${String(cap === 1000 ? "none" : cap).padStart(4)}  ${r.toFixed(3)}    ${p.toFixed(3)}       ${(ceil / total).toFixed(3)}`);
    }
  }
})();
