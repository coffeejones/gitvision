// What does the panel hide? classifySinks marks a sink `unreachable` when no
// path from an entry point was found, and SecurityPanel filters those out.
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { classifySinks } from "../lib/security/reachability";
(async () => {
  for (const d of process.argv.slice(2)) {
    const { codeGraph: cg } = await analyzeDirectory(path.resolve(d), ALL_PLUGINS);
    const rep = classifySinks(cg);
    const hidden = rep.findings.filter((f) => f.reachability === "unreachable");
    console.log(`  ${path.basename(path.resolve(d))}: ${rep.findings.length} findings, ${hidden.length} hidden as unreachable`);
    for (const f of hidden.slice(0, 6))
      console.log(`     ${f.ruleId}  ${f.filePath}:${f.line}  in ${f.inFunction ?? "?"}()`);
  }
})();
