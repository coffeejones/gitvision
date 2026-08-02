// End-to-end through the PRODUCT's own path: analyzeDirectory -> classifySinks
// -> buildUnifiedFindings, exactly as FindingsList does it.
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { classifySinks, sinkRuleLabel, REACHABILITY_LABELS, formatPath } from "../lib/security/reachability";
import { buildUnifiedFindings } from "../lib/security/unifiedFindings";
import { findingKeyOf } from "../lib/security/disclosure";

(async () => {
  const dir = path.resolve(process.argv[2]);
  const { codeGraph } = await analyzeDirectory(dir, ALL_PLUGINS);
  const report = classifySinks(codeGraph);
  const shown = report.findings.filter((f) => f.reachability !== "unreachable");
  const unified = buildUnifiedFindings([], [], [], shown);

  console.log(`repo: ${path.basename(dir)}`);
  console.log(`  classified: ${report.findings.length}   surfaced: ${shown.length}   unified: ${unified.length}`);
  if (unified.length !== shown.length) console.log(`  !! ${shown.length - unified.length} findings LOST between classify and unify`);

  // Every row the UI renders needs a label, a reachability word, a path and a key.
  const problems: string[] = [];
  const seenKeys = new Set<string>();
  for (const u of unified) {
    if (u.kind !== "sink") continue;
    const s: any = u.data;
    if (!sinkRuleLabel(s.ruleId) || sinkRuleLabel(s.ruleId) === s.ruleId) problems.push(`no label: ${s.ruleId}`);
    if (!REACHABILITY_LABELS[s.reachability as keyof typeof REACHABILITY_LABELS]) problems.push(`no reachability word: ${s.reachability}`);
    if (s.path && !formatPath(s.path)) problems.push(`unrenderable path: ${s.ruleId}`);
    if (s.reachability === "reachable" && !s.path) problems.push(`reachable but NO path to show: ${s.ruleId}`);
    const k = findingKeyOf(s);
    if (seenKeys.has(k)) problems.push(`DUPLICATE key: ${k}`);
    seenKeys.add(k);
  }
  console.log(`  render problems: ${problems.length}`);
  for (const p of [...new Set(problems)].slice(0, 8)) console.log(`     ${p}`);

  console.log("  --- what the user sees first (top 8) ---");
  for (const u of unified.slice(0, 8)) {
    const s: any = u.data;
    const ev = s.taint ? `taint:${s.taint.source}` : s.taintedByParam ? `param:${s.taintedByParam}` : "—";
    console.log(`   [${u.severity.padEnd(6)}] ${String(s.reachability).padEnd(12)} ${sinkRuleLabel(s.ruleId).slice(0,42).padEnd(43)} ${ev}`);
  }
  const order = unified.filter(u=>u.kind==="sink").map((u:any)=>u.data.reachability);
  const firstUnknown = order.indexOf("unknown");
  const lastReachable = order.lastIndexOf("reachable");
  if (firstUnknown >= 0 && lastReachable > firstUnknown) {
    console.log(`  !! ORDERING BUG: a 'reachable' finding sits at ${lastReachable}, below an 'unknown' at ${firstUnknown}`);
  } else {
    console.log("  ordering: demonstrated findings rank above unproven ones ✓");
  }
})();
