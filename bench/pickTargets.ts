// The files testsToRun actually makes a claim about, that the suite also runs.
import fs from "node:fs";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety } from "../lib/refactorSafety";
(async () => {
  const { codeGraph } = await analyzeDirectory(process.cwd(), ALL_PLUGINS);
  const rep = computeRefactorSafety(codeGraph, { withTests: true });
  const covered = new Set<string>();
  const dir = "/tmp/cov";
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      for (const [abs, e] of Object.entries(JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")) as Record<string, {s?:Record<string,number>}>)) {
        if (Object.values(e.s ?? {}).some((n) => n > 0)) covered.add(abs.replace(`${process.cwd()}/`, ""));
      }
    } catch {}
  }
  const targets = rep.files
    .filter((f) => f.testsToRun && f.testsToRun.length > 0 && covered.has(f.file) && f.file.endsWith(".ts"))
    .slice(0, Number(process.env.N ?? 20))
    .map((f) => f.file);
  console.log(targets.join("\n"));
})();
