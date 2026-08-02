// SHARPER GROUND TRUTH than coverage for "which tests guard this file".
//
// Coverage answers "which tests EXECUTE this file" — which over-counts badly:
// 27 test files "cover" deterministicSort.ts, none of them test sorting. They
// just load it transitively. Scoring against that blames us for omitting tests
// that would never have caught anything.
//
// This answers the question that matters: break the file, and see which tests
// NOTICE. Mutations are chosen to keep the file type-correct — a compile error
// would fail the whole suite and measure nothing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Token flips that change behaviour but keep TypeScript happy. */
const FLIPS: [RegExp, string][] = [
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ >= /g, " < "],
  [/ <= /g, " > "],
  [/\btrue\b/g, "false"],
  [/\bfalse\b/g, "true"],
  [/ \&\& /g, " || "],
];

/** Lines the test suite actually executes, from the coverage oracle. Mutating
 *  a line nobody runs measures nothing — the first version of this did exactly
 *  that and reported zero guards for a file with 17 real tests. */
function executedLines(file: string): Set<number> {
  const hit = new Set<number>();
  const dir = process.env.COV ?? "/tmp/cov";
  if (!fs.existsSync(dir)) return hit;
  const abs = `${process.cwd()}/${file}`;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let cov: Record<string, { statementMap?: Record<string, { start: { line: number } }>; s?: Record<string, number> }>;
    try { cov = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")); } catch { continue; }
    const entry = cov[abs];
    if (!entry?.s || !entry.statementMap) continue;
    for (const [id, count] of Object.entries(entry.s)) {
      if (count > 0) {
        const line = entry.statementMap[id]?.start?.line;
        if (line) hit.add(line);
      }
    }
  }
  return hit;
}

function mutantsFor(src: string, max: number, executed: Set<number>): { text: string; what: string }[] {
  const out: { text: string; what: string }[] = [];
  const lines = src.split("\n");
  // Deterministic spread: walk lines, take the first flip that applies, skip
  // comment lines so we mutate behaviour and not prose.
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    if (executed.size > 0 && !executed.has(i + 1)) continue;
    for (const [re, to] of FLIPS) {
      re.lastIndex = 0;
      if (!re.test(line)) continue;
      const copy = [...lines];
      copy[i] = line.replace(re, to);
      out.push({ text: copy.join("\n"), what: `L${i + 1}: ${re.source} -> ${to}` });
      break;
    }
    // Space the mutants out so they don't all land in one function.
    if (out.length) i += Math.max(1, Math.floor(lines.length / (max * 2)));
  }
  return out;
}

/** Test files that FAIL with this source in place. */
function failingTests(): string[] {
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=json", "--outputFile=/tmp/mut.json"], {
      stdio: "ignore", timeout: 600_000,
    });
    return [];
  } catch {
    // Non-zero exit = failures, which is the signal we want.
  }
  try {
    const r = JSON.parse(fs.readFileSync("/tmp/mut.json", "utf8"));
    return [...new Set(
      (r.testResults ?? [])
        .filter((t: { status: string }) => t.status === "failed")
        .map((t: { name: string }) => t.name.replace(`${process.cwd()}/`, "")),
    )] as string[];
  } catch {
    return [];
  }
}

(async () => {
  const targets = process.argv.slice(2);
  const MUTANTS = Number(process.env.MUTANTS ?? 3);
  const result: Record<string, string[]> = {};
  for (const file of targets) {
    const original = fs.readFileSync(file, "utf8");
    const executed = executedLines(file);
    const muts = mutantsFor(original, MUTANTS, executed);
    const guards = new Set<string>();
    try {
      for (const m of muts) {
        fs.writeFileSync(file, m.text);
        for (const t of failingTests()) guards.add(t);
      }
    } finally {
      fs.writeFileSync(file, original); // always restore
    }
    result[file] = [...guards].sort();
    console.error(`  ${file}: ${muts.length} mutants over ${executed.size} executed lines -> ${guards.size} guarding test files`);
  }
  console.log(JSON.stringify(result, null, 2));
})();
