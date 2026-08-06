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
        // Conditional, because it is conditional: a change only breaks things
        // if it breaks things. What is certain is that nothing would catch it.
        soWhat: `Change this and ${f.dependents} other file${f.dependents === 1 ? "" : "s"} could break with nothing to catch it.`,
        title: f.file,
        evidence: `No test file imports or calls it, and ${f.dependents} file${f.dependents === 1 ? "" : "s"} depend on it${f.untestedDependents > 0 ? ` — ${f.untestedDependents} of those have no tests either` : ""}.`,
        href: `${base}/testquality`,
        term: "untested-hotspot",
      });
    }

    const groups = findDuplicateGroups(cg, { limit: 50 });
    const summary = summarizeDuplicates(groups);
    if (summary.totalGroups > 0) {
      for (const [i, g] of groups.slice(0, MAX_PER_SECTION).entries()) {
        const files = [...new Set(g.members.map((f) => f.filePath))];
        duplicated.push({
          id: `dup:${i}:${g.members[0]?.name ?? i}`,
          soWhat: `Fix a bug here and you have to remember to fix it ${g.members.length - 1} more time${g.members.length === 2 ? "" : "s"}.`,
          title: `${g.members[0]?.name ?? "Duplicated code"} — ${g.members.length} copies`,
          evidence: `The same code appears in ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}. Editing one copy leaves the others as they were.`,
          href: `${base}/code`,
          term: "near-duplicate",
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
        soWhat: `${hollow} of your test file${hollow === 1 ? "" : "s"} would pass even if the code were broken.`,
        title: `${hollow} test file${hollow === 1 ? "" : "s"} assert almost nothing`,
        evidence:
          "They run and they finish green, but they make no meaningful check on the result. A coverage number counts them; a regression walks past them.",
        href: `${base}/testquality`,
        term: "hollow-test",
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
        "No untested file has anything depending on it, no code is duplicated, and every test suite checks something. On a small or well-covered repo that is a real answer.",
    },
    answerFor(risky.length, duplicated.length, weak.length, gaps),
  );
}

/** The answer, from the same counts the sections were built from. */
function answerFor(
  risky: number,
  duplicated: number,
  weak: number,
  gaps: { kind: string }[],
): { answer: string; howToRead: string } {
  const blocked = gaps.some((g) => g.kind === "blocking");
  if (blocked && risky + duplicated + weak === 0) {
    return {
      answer: "We could not answer this one.",
      howToRead:
        "Nothing was found, but the analysis was blocked before it could look. What stopped it is at the bottom of the page.",
    };
  }
  const parts: string[] = [];
  if (risky > 0) parts.push(`${risky} file${risky === 1 ? " is" : "s are"} depended on with no test to catch a break`);
  if (duplicated > 0) parts.push(`${duplicated} piece${duplicated === 1 ? "" : "s"} of code exist${duplicated === 1 ? "s" : ""} in more than one place`);
  if (weak > 0) parts.push("some tests would pass even if the code were broken");
  if (parts.length === 0) {
    return {
      answer: "Nothing here is urgent.",
      howToRead: "No untested file has anything depending on it, and nothing is duplicated.",
    };
  }
  return {
    answer: `${parts[0][0].toUpperCase()}${parts.slice(0, 2).join(", and ").slice(1)}.`,
    howToRead:
      "Start at the top — that is the one where a mistake costs most. Each row links to the file and the numbers behind it.",
  };
}
