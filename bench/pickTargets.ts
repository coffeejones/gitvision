// The files testsToRun actually makes a claim about, that the suite also runs.
import fs from "node:fs";
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety } from "../lib/refactorSafety";
// A PINNED list, when one exists. The targets are chosen from refactor-safety
// tiers, so any change to the graph moves them — and a recall number measured
// on a different sample is not comparable to the one before it. Regenerating
// this file is a deliberate act: delete it, re-run, and say in the commit that
// the baseline moved.
const PINNED = path.join(process.cwd(), "bench", "blast-targets.txt");

(async () => {
  if (fs.existsSync(PINNED) && !process.env.REPICK) {
    process.stdout.write(fs.readFileSync(PINNED, "utf-8"));
    return;
  }
  const ROOT = process.argv[2] ?? process.cwd();
  const { codeGraph } = await analyzeDirectory(ROOT, ALL_PLUGINS);
  const rep = computeRefactorSafety(codeGraph, { withTests: true });
  const covered = new Set<string>();
  const dir = process.env.COV ?? "/tmp/cov";
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      for (const [abs, e] of Object.entries(JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")) as Record<string, {s?:Record<string,number>}>)) {
        if (Object.values(e.s ?? {}).some((n) => n > 0)) covered.add(abs.replace(`${ROOT}/`, ""));
      }
    } catch {}
  }
  const targets = rep.files
    .filter((f) => f.testsToRun && f.testsToRun.length > 0 && /\.(ts|py)$/.test(f.file))
    .slice(0, Number(process.env.N ?? 20))
    .map((f) => f.file);
  console.log(targets.join("\n"));
})();
