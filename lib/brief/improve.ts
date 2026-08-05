// "What is worth cleaning up?" — ranked by what a regression would cost.
//
// Not a lint list. Every item here is something where a change can break
// something else quietly, which is the only version of "technical debt" this
// product can evidence: untested code that many files depend on, bodies
// duplicated so a fix lands in one copy and not the others, and test files that
// run without asserting anything.
//
// Deliberately NOT ranked by complexity. A big function is long to read; a
// load-bearing untested one is where the next outage comes from. The Code tab
// already lists the former.

import type { AnalysisSnapshot } from "../types";
import { computeRefactorSafety } from "../refactorSafety";
import { findDuplicateGroups, summarizeDuplicates } from "../codeAnalysis/duplicates";
import { buildCoverageReport } from "../coverage";
import { assemble, type Brief, type BriefItem } from "./types";

const MAX_PER_SECTION = 5;

export function buildImproveBrief(
  snap: AnalysisSnapshot,
  sessionId: string,
): Brief {
  const base = `/session/${sessionId}`;
  const cg = snap.codeGraph;

  const risky: BriefItem[] = [];
  const duplicated: BriefItem[] = [];
  const weak: BriefItem[] = [];

  if (cg) {
    const safety = computeRefactorSafety(cg, { withTests: true });

    // The intersection that matters: depended upon AND untested. Either alone
    // is ordinary; together it is a silent break waiting for a Tuesday.
    const exposed = safety.files
      .filter((f) => !f.tested && f.dependents > 0)
      .sort((a, b) => b.untestedDependents - a.untestedDependents || b.dependents - a.dependents)
      .slice(0, MAX_PER_SECTION);
    for (const [i, f] of exposed.entries()) {
      risky.push({
        id: `exposed:${i}:${f.file}`,
        title: f.file,
        evidence: `No test reaches it, and ${f.dependents} file${f.dependents === 1 ? "" : "s"} depend on it${f.untestedDependents > 0 ? ` — ${f.untestedDependents} of those are untested too` : ""}.`,
        href: `${base}/testquality`,
      });
    }

    const groups = findDuplicateGroups(cg, { limit: 50 });
    const summary = summarizeDuplicates(groups);
    if (summary.totalGroups > 0) {
      for (const [i, g] of groups.slice(0, MAX_PER_SECTION).entries()) {
        const files = [...new Set(g.members.map((f) => f.filePath))];
        duplicated.push({
          id: `dup:${i}:${g.members[0]?.name ?? i}`,
          title: `${g.members[0]?.name ?? "Duplicated body"} — ${g.members.length} copies`,
          evidence: `Structurally identical across ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}. A fix in one copy does not reach the others.`,
          href: `${base}/code`,
        });
      }
    }
  }

  // weakSuite is computed at analysis time and stored, so this is a read.
  const ws = snap.weakSuite;
  if (ws) {
    // "hollow" is weakSuite's own word for a suite that runs and asserts
    // nothing worth failing on — not a name invented here.
    const hollow = ws.counts.hollow ?? 0;
    if (hollow > 0) {
      weak.push({
        id: "weak:hollow",
        title: `${hollow} test file${hollow === 1 ? "" : "s"} assert almost nothing`,
        evidence:
          "They run, and they pass whatever the code does — no assertions, or no oracle worth failing on. Coverage counts them; a regression does not.",
        href: `${base}/testquality`,
      });
    }
  }

  const gaps = buildCoverageReport(snap).filter(
    (g) => g.surface === "code" || g.surface === "session",
  );

  return assemble(
    "improve",
    "Composed from the Test quality, Refactor and Code tabs, ranked by what a regression would cost rather than by size — a long function is only long to read.",
    [
      {
        id: "risky",
        label: "Untested, and depended upon",
        note: "Either alone is ordinary. Together it is where a change breaks something silently.",
        items: risky,
      },
      {
        id: "duplicated",
        label: "Copies that will drift",
        note: "Structurally identical bodies. A fix lands in one of them.",
        items: duplicated,
      },
      {
        id: "weak",
        label: "Tests that pass regardless",
        note: "They run and they count toward coverage. They will not fail on a regression.",
        items: weak,
      },
    ],
    gaps,
    {
      headline: "Nothing stands out as worth cleaning up.",
      detail:
        "No untested file has dependents, no duplicated bodies were found, and no test file asserts nothing. That is a real answer on a small or well-covered repo.",
    },
  );
}
