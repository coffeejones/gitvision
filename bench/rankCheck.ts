import fs from "node:fs";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety, buildFanIn } from "../lib/refactorSafety";
import { isTestFile } from "../lib/codeAnalysis/testCoverage";
(async () => {
  const oracle: Record<string,string[]> = JSON.parse(fs.readFileSync("/tmp/mutation.json","utf8"));
  const { codeGraph: cg } = await analyzeDirectory(process.cwd(), ALL_PLUGINS);
  const rep = computeRefactorSafety(cg, { withTests: true });
  const fanIn = buildFanIn(cg);
  const direct = new Map<string, Set<string>>();
  const add = (p: string|null|undefined, s: string) => {
    if (!p || !isTestFile(s) || isTestFile(p)) return;
    let x = direct.get(p); if (!x) { x = new Set(); direct.set(p, x); } x.add(s);
  };
  for (const e of cg.imports) add(e.to, e.from);
  for (const c of cg.calls) if (c.toFile) add(c.toFile, c.fromFile);

  console.log("Are the MISSED guarding tests in the graph at all, or ranked out by the cap of 6?\n");
  for (const [file, actual] of Object.entries(oracle)) {
    if (!actual.length) continue;
    const f = rep.files.find((x) => x.file === file);
    const listed = f?.testsToRun?.map((t) => t.file) ?? [];
    const miss = actual.filter((t) => !listed.includes(t));
    if (!miss.length) continue;
    // Rebuild the FULL candidate set the cap was applied to.
    const affected = new Set<string>([file]);
    for (const [tgt, srcs] of fanIn) if (tgt === file) for (const d of srcs) affected.add(d);
    const cand = new Set<string>();
    for (const a of affected) for (const t of direct.get(a) ?? []) cand.add(t);
    const inGraph = miss.filter((t) => cand.has(t));
    const absent = miss.filter((t) => !cand.has(t));
    console.log(`  ${file}`);
    console.log(`     candidates before the slice(0,6): ${cand.size}`);
    console.log(`     missed but IN the candidate set (ranked out): ${inGraph.length ? inGraph.join(", ") : "none"}`);
    console.log(`     missed and ABSENT from the graph:             ${absent.length ? absent.join(", ") : "none"}`);
  }
})();
