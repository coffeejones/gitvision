#!/usr/bin/env node
// Call-graph PRECISION harness.
//
// We have always measured coverage — "what fraction of call sites resolved" —
// which says nothing about whether the resolved ones point at the RIGHT target.
// Both of the largest correctness bugs in this project's history (parse.ts shown
// as depending on SignalsPanel.tsx; sibling methods collapsing into one node)
// were found by a human eyeballing a UI panel. Neither left a regression test,
// and the golden fixtures structurally cannot catch them: ~20 hand-written
// functions have no cross-module edges to get wrong.
//
// THE FALSIFIER. A resolved edge fromFile -> toFile is JUSTIFIED when the
// snapshot's own import graph explains it: same file, or fromFile imports
// toFile. Anything else is a cross-module edge the code gives no reason for —
// resolved by name-uniqueness luck rather than evidence. That single mechanical
// check would have caught the parse.ts bug automatically.
//
// This is a precision LOWER bound, deliberately. Dynamic dispatch, DI, and
// re-exports produce real edges with no direct import, so some suspects are
// legitimate. It is a ranked review queue and a regression gate, not a verdict.
//
//   npm run graph-precision              # table + suspect samples, all snapshots
//   npm run graph-precision -- zod 20    # one repo, 20 samples
//
// Reads .gitvision/sessions/*.json only: no GitHub fetch, no re-parse, no API cost.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SESSIONS = path.join(ROOT, ".gitvision", "sessions");
const [repoFilter, sampleArg] = process.argv.slice(2);
const SAMPLES = Number(sampleArg) || 12;

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dirOf = (p) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

function loadSnapshots() {
  if (!fs.existsSync(SESSIONS)) return [];
  const out = [];
  const seen = new Set();
  for (const f of fs.readdirSync(SESSIONS).filter((n) => n.endsWith(".json"))) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(SESSIONS, f), "utf8"));
    } catch {
      continue;
    }
    const snaps = (d.snapshots ?? []).filter((s) => s?.codeGraph?.calls?.length);
    if (!snaps.length) continue;
    const repo = String(d.repoUrl ?? "").split("github.com/").pop() || d.id;
    if (seen.has(repo)) continue;
    seen.add(repo);
    out.push({ repo, cg: snaps[snaps.length - 1].codeGraph });
  }
  return out;
}

/** Classify every resolved edge against the snapshot's own import graph. */
function audit(cg) {
  const imports = new Map(); // fromFile -> Set(toFile)
  for (const i of cg.imports ?? []) {
    let s = imports.get(i.from);
    if (!s) imports.set(i.from, (s = new Set()));
    s.add(i.to);
  }
  // How many definitions share each name — an edge to a name with many
  // candidates and no import backing is the highest-risk class of all.
  const byName = new Map();
  for (const fn of cg.functions ?? []) {
    byName.set(fn.name, (byName.get(fn.name) ?? 0) + 1);
  }

  const buckets = { sameFile: 0, imported: 0, samePackage: 0, suspect: 0 };
  const suspects = [];
  for (const c of cg.calls ?? []) {
    if (!c.toFile || !c.toFunction || !c.fromFunction) continue;
    if (c.fromFile === c.toFile) {
      buckets.sameFile++;
      continue;
    }
    if (imports.get(c.fromFile)?.has(c.toFile)) {
      buckets.imported++;
      continue;
    }
    // Package-scoped languages (Go, Java, C#, and to a degree Ruby) let two
    // files in the same directory call each other with NO import statement at
    // all. Judging those as unexplained would manufacture a 60%+ "error rate"
    // for Go and C# that says nothing about correctness. Same directory is the
    // best file-level proxy for same package we have, so it gets its own bucket
    // rather than being counted against the resolver.
    if (dirOf(c.fromFile) === dirOf(c.toFile)) {
      buckets.samePackage++;
      continue;
    }
    buckets.suspect++;
    suspects.push({
      from: `${c.fromFile}::${c.fromFunction}`,
      to: `${c.toFile}::${c.toFunction}`,
      name: c.toFunction,
      candidates: byName.get(c.toFunction) ?? 1,
          });
  }
  const total = buckets.sameFile + buckets.imported + buckets.samePackage + buckets.suspect;
  // Rank the review queue: ambiguous names first, then distant modules.
  suspects.sort(
    (a, b) => b.candidates - a.candidates 
  );
  return { ...buckets, total, suspects };
}

function main() {
  let snaps = loadSnapshots();
  if (repoFilter) {
    snaps = snaps.filter((s) => s.repo.toLowerCase().includes(repoFilter.toLowerCase()));
  }
  if (!snaps.length) {
    console.error(`\n  No snapshots with call graphs in ${SESSIONS}\n`);
    process.exit(1);
  }

  console.log(`\n  ${bold("CALL-GRAPH PRECISION")} — ${snaps.length} local snapshot(s). No API cost.\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const rp = (s, n) => String(s).padStart(n);
  console.log(
    `  ${pad("repo", 28)}${rp("edges", 8)}${rp("same-file", 11)}${rp("imported", 10)}${rp("same-dir", 10)}${rp("SUSPECT", 9)}${rp("suspect%", 10)}`
  );
  console.log("  " + "─".repeat(86));

  const all = [];
  let tot = 0;
  let totSus = 0;
  for (const { repo, cg } of snaps) {
    const a = audit(cg);
    if (a.total === 0) continue;
    const pct = (a.suspect / a.total) * 100;
    console.log(
      `  ${pad(repo.slice(0, 27), 28)}${rp(a.total, 8)}${rp(a.sameFile, 11)}${rp(a.imported, 10)}${rp(a.samePackage, 10)}${rp(a.suspect, 9)}${rp(pct.toFixed(1) + "%", 10)}`
    );
    tot += a.total;
    totSus += a.suspect;
    all.push(...a.suspects.map((s) => ({ repo, ...s })));
  }
  console.log("  " + "─".repeat(86));
  console.log(
    `  ${pad("TOTAL", 28)}${rp(tot, 8)}${rp("", 11)}${rp("", 10)}${rp("", 10)}${rp(totSus, 9)}${rp(tot ? ((totSus / tot) * 100).toFixed(1) + "%" : "—", 10)}`
  );
  console.log(
    `\n  ${dim("SUSPECT = a cross-file edge the import graph gives no reason for. Some are legitimate")}`
  );
  console.log(
    `  ${dim("(dynamic dispatch, DI, re-exports) — this is a ranked review queue, not a verdict.")}\n`
  );

  // Highest-risk first: many same-named definitions, different directory.
  all.sort((a, b) => b.candidates - a.candidates );
  console.log(`  ${bold("HIGHEST-RISK SUSPECTS")} ${dim("(most same-named definitions first)")}\n`);
  for (const s of all.slice(0, SAMPLES)) {
    console.log(
      `  ${dim(s.repo)}  ${dim(`${s.candidates} definitions named "${s.name}"`)}`
    );
    console.log(`    ${s.from}`);
    console.log(`      → ${s.to}\n`);
  }

  console.log(
    `  ${bold("READ THIS AS")} ${dim("a queue: confirm a handful by hand. A real false edge is a resolver bug;")}`
  );
  console.log(
    `  ${dim("a legitimate one tells you which evidence the resolver should be allowed to use.")}\n`
  );
}

main();
