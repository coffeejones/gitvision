// Score the blast-radius claim "these are the tests worth running" against
// coverage ground truth produced by bench/testOracle.sh.
//
// RECALL is the safety property here, not precision. A test that fails but was
// never listed means we told someone they did not need to run it. A test we
// listed that passes is at worst wasted CPU.
import fs from "node:fs";
import path from "node:path";
import { ALL_PLUGINS } from "../lib/codeAnalysis/plugins/all";
import { analyzeDirectory } from "../lib/codeAnalysis/analyze";
import { computeRefactorSafety, buildFanIn } from "../lib/refactorSafety";
import { isTestFile } from "../lib/codeAnalysis/testCoverage";

const COV = process.argv[2] ?? "/tmp/cov";
const ROOT = process.cwd();

/** ground truth: source file -> test files that actually execute it */
function loadOracle(): Map<string, Set<string>> {
  const byProd = new Map<string, Set<string>>();
  // The oracle filenames are paths with "/" replaced by "_", which is LOSSY —
  // `lib/__tests__/x.test.ts` and `lib___tests___x.test.ts` collapse together.
  // Rebuild the mapping from the real files instead of trying to invert it.
  const keyToPath = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(e.name)) keyToPath.set(full.replace(/\//g, "_"), full);
    }
  };
  for (const d of ["lib", "components", "app"]) walk(d);

  for (const f of fs.readdirSync(COV)) {
    if (!f.endsWith(".json") || f === "run.log") continue;
    const testFile = keyToPath.get(f.replace(/\.json$/, ""));
    if (!testFile) continue;
    let cov: Record<string, { s?: Record<string, number> }>;
    try { cov = JSON.parse(fs.readFileSync(path.join(COV, f), "utf8")); } catch { continue; }
    for (const [abs, entry] of Object.entries(cov)) {
      const executed = Object.values(entry.s ?? {}).some((n) => n > 0);
      if (!executed) continue;
      const rel = path.relative(ROOT, abs);
      if (rel.startsWith("..") || isTestFile(rel)) continue;
      let s = byProd.get(rel);
      if (!s) { s = new Set(); byProd.set(rel, s); }
      s.add(testFile);
    }
  }
  return byProd;
}

(async () => {
  const oracle = loadOracle();
  console.log(`oracle: ${oracle.size} source files with observed test coverage`);

  const { codeGraph: cg } = await analyzeDirectory(ROOT, ALL_PLUGINS);
  const report = computeRefactorSafety(cg, { withTests: true });
  const fanIn = buildFanIn(cg);

  // The primitive: one-hop test -> prod edges, rebuilt exactly as refactorSafety does.
  const direct = new Map<string, Set<string>>();
  const add = (prod: string | null | undefined, src: string) => {
    if (!prod || !isTestFile(src) || isTestFile(prod)) return;
    let s = direct.get(prod); if (!s) { s = new Set(); direct.set(prod, s); }
    s.add(src);
  };
  for (const e of cg.imports) add(e.to, e.from);
  for (const c of cg.calls) if (c.toFile) add(c.toFile, c.fromFile);

  // The user-facing claim: testsToRun, only computed for high-tier files.
  const predicted = new Map<string, Set<string>>();
  for (const f of report.files) {
    if (f.testsToRun) predicted.set(f.file, new Set(f.testsToRun.map((t) => t.file)));
  }

  const score = (label: string, pred: Map<string, Set<string>>, only?: Set<string>) => {
    let tp = 0, missed = 0, extra = 0, files = 0, filesWithAMiss = 0;
    const worst: { file: string; missed: string[]; had: number }[] = [];
    for (const [prod, actual] of oracle) {
      if (only && !only.has(prod)) continue;
      const p = pred.get(prod) ?? new Set<string>();
      files++;
      const miss = [...actual].filter((t) => !p.has(t));
      tp += actual.size - miss.length;
      missed += miss.length;
      extra += [...p].filter((t) => !actual.has(t)).length;
      if (miss.length) { filesWithAMiss++; worst.push({ file: prod, missed: miss, had: actual.size }); }
    }
    const recall = tp + missed ? tp / (tp + missed) : 0;
    const prec = tp + extra ? tp / (tp + extra) : 0;
    console.log(`\n${label}`);
    console.log(`  source files scored:        ${files}`);
    console.log(`  test-file links recovered:  ${tp}   missed: ${missed}   surplus: ${extra}`);
    console.log(`  RECALL  ${recall.toFixed(3)}   (the safety property)`);
    console.log(`  precision ${prec.toFixed(3)}`);
    console.log(`  files where we missed at least one guarding test: ${filesWithAMiss}/${files}`);
    worst.sort((a, b) => b.missed.length - a.missed.length);
    for (const w of worst.slice(0, 6)) {
      console.log(`     ${w.file}  missed ${w.missed.length}/${w.had}: ${w.missed.slice(0, 3).join(", ")}`);
    }
  };

  score("A. the primitive — direct test->file edges only", direct);

  // testsToRun's own union: {file} ∪ dependents(file), tests over all of them.
  const union = new Map<string, Set<string>>();
  for (const prod of oracle.keys()) {
    const s = new Set<string>(direct.get(prod) ?? []);
    for (const [target, srcs] of fanIn) {
      if (target !== prod) continue;
      for (const d of srcs) for (const t of direct.get(d) ?? []) s.add(t);
    }
    union.set(prod, s);
  }
  score("B. with dependents folded in (how testsToRun composes)", union);

  score("C. the shipped claim — testsToRun, high-tier files only", predicted,
        new Set(predicted.keys()));
})();
