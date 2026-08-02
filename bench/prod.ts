import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { classifySinks } from "../lib/security/reachability";
async function main(){ let t=0; const by: Record<string,number> = {};
 for (const d of process.argv.slice(2)) {
  const { codeGraph: cg } = await analyzeDirectory(path.resolve(d), ALL_PLUGINS);
  const rep = classifySinks(cg);
  const shown = rep.findings.filter((f:any)=>f.reachability!=="unreachable");
  for (const f of shown as any[]) by[f.ruleId]=(by[f.ruleId]??0)+1;
  t+=shown.length;
  console.log(`  ${path.basename(path.resolve(d))}: ${shown.length}`);
 }
 console.log(`  TOTAL surfaced ${t}`);
 console.log("  by rule:", JSON.stringify(by));
}
main();
