#!/usr/bin/env tsx
// Run the verification-rules engine against the P8 eval-run's captured
// diff (Flask 3.0.0 → main, ~351 ChangedFunction[]) and print the
// suggestions it produces. Lets a human eyeball whether the rules fire
// on sensible cases and whether the suggestion text reads naturally
// at PR-comment grade.
//
// Usage:
//   npx tsx scripts/validateRulesOnP8.ts
//   npx tsx scripts/validateRulesOnP8.ts <path-to-truth.json>
//
// When no path is given, picks the most recent run dir that contains
// a P8_diff_review.json truth file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  evaluateVerificationRules,
  registeredRules,
  type VerificationSuggestion,
} from "../lib/codeAnalysis/verificationRules";
import type { DiffResult, ChangedFunction } from "../lib/codeAnalysis/diffAware";

function findLatestP8Truth(): string {
  const runsDir = path.join(process.cwd(), "eval", "runs");
  const dirs = readdirSync(runsDir)
    .map((d) => path.join(runsDir, d))
    .filter((p) => statSync(p).isDirectory())
    .sort()
    .reverse();
  for (const d of dirs) {
    const truth = path.join(d, "ground_truth", "py_flask", "P8_diff_review.json");
    try {
      statSync(truth);
      return truth;
    } catch {
      continue;
    }
  }
  throw new Error("No P8_diff_review.json truth file found in eval/runs/");
}

function loadDiff(truthPath: string): DiffResult {
  const raw = JSON.parse(readFileSync(truthPath, "utf8"));
  // The eval handler stores curated changes under `changes` and the
  // overflow under `_full_changes`. For a realistic validation we
  // combine them — the rules engine would see the full diff in
  // production, not the eval-curated subset.
  const curated: ChangedFunction[] = raw.changes ?? [];
  const overflow: ChangedFunction[] = raw._full_changes ?? [];
  const allChanges = [...curated, ...overflow];
  return {
    summary: raw.summary,
    changes: allChanges,
  };
}

function fmtSuggestion(s: VerificationSuggestion, n: number): string {
  const sevIcon =
    s.severity === "critical" ? "🔴" :
    s.severity === "warning"  ? "🟡" : "🟢";
  return [
    `${n}. ${sevIcon} ${s.severity.toUpperCase()} · [${s.ruleId}] · impact=${s.impactScore ?? 0}`,
    `   ${s.text}`,
    `   evidence: ${s.evidence.join(", ")}`,
  ].join("\n");
}

function main() {
  const truthPath = process.argv[2] ?? findLatestP8Truth();
  console.log(`\n=== Loading diff from ${path.relative(process.cwd(), truthPath)} ===\n`);

  const diff = loadDiff(truthPath);
  console.log("Diff summary:");
  console.log(`  files changed:        ${diff.summary.filesChanged}`);
  console.log(`  functions added:      ${diff.summary.functionsAdded}`);
  console.log(`  functions removed:    ${diff.summary.functionsRemoved}`);
  console.log(`  functions modified:   ${diff.summary.functionsModified}`);
  console.log(`  net complexity Δ:     ${diff.summary.netComplexityDelta}`);
  console.log(`  total ChangedFunction entries scanned: ${diff.changes.length}`);

  console.log(`\nRegistered rules:`);
  for (const r of registeredRules()) {
    console.log(`  - ${r.id}`);
  }

  console.log(`\n=== Top-3 suggestions (PR-comment default cap) ===\n`);
  const top3 = evaluateVerificationRules({ diff });
  if (top3.length === 0) {
    console.log("(no suggestions — rules didn't fire on this diff)\n");
  } else {
    top3.forEach((s, i) => console.log(fmtSuggestion(s, i + 1) + "\n"));
  }

  console.log(`=== Full output (all matches, sorted) ===\n`);
  const all = evaluateVerificationRules({ diff }, { maxResults: 1000 });
  console.log(`Total suggestions: ${all.length}\n`);
  // Per-rule breakdown
  const byRule = new Map<string, number>();
  for (const s of all) byRule.set(s.ruleId, (byRule.get(s.ruleId) ?? 0) + 1);
  console.log("Breakdown by rule:");
  for (const [id, count] of [...byRule.entries()].sort()) {
    console.log(`  ${count.toString().padStart(4)} × ${id}`);
  }
  console.log();

  // Show first 5 from each rule for sampling
  console.log("First 3 from each rule:");
  for (const r of registeredRules()) {
    const matches = all.filter((s) => s.ruleId === r.id);
    if (matches.length === 0) continue;
    console.log(`\n--- ${r.id} (${matches.length} total) ---`);
    matches.slice(0, 3).forEach((s, i) => console.log(fmtSuggestion(s, i + 1)));
  }
  console.log();
}

main();
