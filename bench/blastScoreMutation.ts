// Score testsToRun against the MUTATION oracle: tests that actually FAIL when
// the file is broken. This is the honest denominator — coverage counts tests
// that merely load a file, and blaming us for omitting those understates the
// tool.
import fs from "node:fs";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety } from "../lib/refactorSafety";

(async () => {
  const oracle: Record<string, string[]> = JSON.parse(
    fs.readFileSync(process.argv[2] ?? "/tmp/mutation.json", "utf8"),
  );
  const ROOT = process.argv[3] ?? process.cwd();
  const { codeGraph } = await analyzeDirectory(ROOT, ALL_PLUGINS);
  const rep = computeRefactorSafety(codeGraph, { withTests: true });
  const predicted = new Map<string, string[]>();
  for (const f of rep.files) if (f.testsToRun) predicted.set(f.file, f.testsToRun.map((t) => t.file));

  let tp = 0, missed = 0, extra = 0, scored = 0, perfect = 0, blind = 0;
  const rows: string[] = [];
  for (const [file, actual] of Object.entries(oracle)) {
    if (actual.length === 0) { blind++; continue; }   // no mutant was caught at all
    const pred = predicted.get(file) ?? [];
    scored++;
    const hit = actual.filter((t) => pred.includes(t));
    const miss = actual.filter((t) => !pred.includes(t));
    tp += hit.length; missed += miss.length;
    extra += pred.filter((t) => !actual.includes(t)).length;
    if (miss.length === 0) perfect++;
    rows.push(
      `  ${miss.length === 0 ? "OK  " : "MISS"} ${file}\n` +
      `        caught by:  ${actual.join(", ")}\n` +
      `        we listed:  ${pred.length ? pred.join(", ") : "(nothing)"}`,
    );
  }
  const recall = tp + missed ? tp / (tp + missed) : 0;
  const prec = tp + extra ? tp / (tp + extra) : 0;
  console.log(`files scored: ${scored}   (skipped ${blind} where no mutant was caught by any test)`);
  console.log(`guarding links recovered: ${tp}   missed: ${missed}   surplus: ${extra}`);
  console.log(`RECALL    ${recall.toFixed(3)}   <- the safety property`);
  console.log(`precision ${prec.toFixed(3)}`);
  console.log(`files where every guarding test was listed: ${perfect}/${scored}\n`);
  for (const r of rows) console.log(r);
})();
