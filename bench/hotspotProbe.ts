// Is the "write a test for this" queue actionable?
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeTestCoverage } from "../lib/codeAnalysis/testCoverage";
(async () => {
  const root = path.resolve(process.argv[2] ?? ".");
  const { codeGraph: cg } = await analyzeDirectory(root, ALL_PLUGINS);
  const cov = computeTestCoverage(cg);
  const top = (cov.untestedHotspots ?? []).slice(0, 25);
  console.log(`${path.basename(root)} — top ${top.length} untested hotspots`);
  let closures = 0, components = 0;
  for (const [i, h] of top.entries()) {
    const fn = cg.functions.find((f) => f.filePath === h.filePath && f.name === h.name);
    // A React component: PascalCase in a .tsx file. A nested closure: the
    // plugins' own `visit`/`walk` recursion, which no caller can name.
    const isComponent = /\.tsx$/.test(h.filePath) && /^[A-Z]/.test(h.name);
    const isClosure = /^(visit|walk|scanBody|recurse|inner)$/.test(h.name);
    if (isComponent) components++;
    if (isClosure) closures++;
    if (i < 8) console.log(`  ${String(i + 1).padStart(2)}. cx${String(fn?.complexity ?? "?").padStart(3)}  ${h.name}  ${h.filePath}${isClosure ? "   <- nested closure" : isComponent ? "   <- React component" : ""}`);
  }
  console.log(`  of the top ${top.length}: ${closures} nested closures, ${components} React components`);
})();
