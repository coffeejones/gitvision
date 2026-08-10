// "Where do I start?" — the question someone asks about a repo they inherited.
//
// The pieces exist on four tabs. Entry points are on Flows, load-bearing files
// on Refactor, the heaviest files on Code, and the class structure on
// Architecture. Reading them in that order is a skill; a newcomer does not have
// it, and the workspace does not teach it.
//
// The order here IS the answer: doors first, then what everything leans on,
// then the heaviest reading. Nothing is computed for this page — every line is
// a field on the snapshot or an existing helper, and every line links back.

import type { AnalysisSnapshot } from "../types";
import { buildFlowIndex, findDeclaredEntryPoints } from "../codeAnalysis/flowTrace";
import { computeRefactorSafety } from "../refactorSafety";
import { computeOwnCallResolution } from "../codeAnalysis/callResolution";
import { buildCoverageReport } from "../coverage";
import { assemble, type Brief, type BriefItem } from "./types";

const MAX_PER_SECTION = 5;

export function buildUnderstandBrief(
  snap: AnalysisSnapshot,
  sessionId: string,
): Brief {
  const base = `/session/${sessionId}`;
  const cg = snap.codeGraph;

  const doors: BriefItem[] = [];
  const leaned: BriefItem[] = [];
  const heavy: BriefItem[] = [];

  if (cg) {
    // DECLARED entry points, not guessed ones. A route decorator or a handler
    // registration is a fact the parser read; "looks like an entry point" is a
    // heuristic and belongs on the Flows tab where it can be argued with.
    const index = buildFlowIndex(cg);
    const entries = findDeclaredEntryPoints(cg, index)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_SECTION);
    for (const [i, e] of entries.entries()) {
      // The URL, when the declaration carried one. "GET /api/sessions" is the
      // thing the reader recognises; the function's name is our word for it.
      // Showing "a declared route-like" while holding the actual path was
      // hiding the best evidence we have behind a category name.
      const method = e.declared?.methods?.join("/");
      const label =
        e.declared?.route !== undefined
          ? `${method ? `${method} ` : ""}${e.declared.route}`
          : e.name;
      doors.push({
        id: `entry:${i}:${e.id}`,
        soWhat: `When something outside calls this project, this is one of the places it lands.`,
        title: `${label} — ${e.filePath}`,
        evidence:
          (e.declared?.via
            ? `Declared by \`${e.declared.via}\` — the code says so, we did not guess it.`
            : `A declared entry point — the code says so, we did not guess it.`) +
          ` From here you can follow ${e.fanOut} function${e.fanOut === 1 ? "" : "s"} in this repo.`,
        href: `${base}/flows`,
        term: "fan-out",
      });
    }

    const safety = computeRefactorSafety(cg, { withTests: true });
    const loadBearing = safety.files
      .filter((f) => f.tier === "load-bearing")
      .sort((a, b) => b.dependents - a.dependents)
      .slice(0, MAX_PER_SECTION);
    for (const [i, f] of loadBearing.entries()) {
      leaned.push({
        id: `wall:${i}:${f.file}`,
        soWhat: `A lot of the project runs through here, so it is worth understanding before you change anything.`,
        title: f.file,
        evidence: `${f.dependents} file${f.dependents === 1 ? "" : "s"} import or call it${f.untestedDependents > 0 ? `, and ${f.untestedDependents} of those have no tests` : ""}.`,
        href: `${base}/refactor`,
        term: "load-bearing",
      });
    }

    const byComplexity = Object.entries(cg.fileComplexity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_PER_SECTION);
    for (const [i, [file, complexity]] of byComplexity.entries()) {
      heavy.push({
        id: `heavy:${i}:${file}`,
        soWhat: `The most to read in one file. Being big is not a problem — it just takes longer.`,
        title: file,
        evidence: `Complexity ${complexity}: a count of the branches and loops inside, added up.`,
        href: `${base}/code?file=${encodeURIComponent(file)}`,
        term: "file-complexity",
      });
    }
  }

  // The resolution floor belongs HERE and nowhere else: it bounds every reach
  // claim above it. Phrased as a floor, never as a defect — most unresolved
  // calls go into libraries this analysis never claimed to index.
  const gaps = buildCoverageReport(snap).filter(
    (g) => g.surface === "code" || g.surface === "session",
  );
  if (cg) {
    const own = computeOwnCallResolution(cg);
    if (own.ownTotal > 0 && own.ownPct < 100) {
      gaps.push({
        id: "call-resolution",
        surface: "code",
        kind: "bounding",
        headline: `${own.ownPct}% of the calls naming a function this repo defines were resolved.`,
        detail:
          "The rest could not be pinned to one definition — same-named methods across classes, or dispatch the parser cannot follow. Reach counts above are a floor, not a total.",
        numbers: { ownResolved: own.ownResolved, ownTotal: own.ownTotal, ownPct: own.ownPct },
      });
    }
  }

  return assemble(
    "understand",
    "Composed from the Flows, Refactor and Code tabs. Doors first, then what everything leans on, then the heaviest reading — nothing here is computed for this page.",
    [
      {
        id: "doors",
        label: "Start at the doors",
        note: "Entry points the parser read from route decorators and handler registrations — not guessed.",
        items: doors,
      },
      {
        id: "leaned",
        label: "What everything leans on",
        note: "Load-bearing files: many dependents, high complexity. Understand these before you change anything.",
        items: leaned,
      },
      {
        id: "heavy",
        label: "The densest files",
        note: "Highest aggregate complexity. Not a problem in itself — just the longest reading.",
        items: heavy,
      },
    ],
    gaps,
    {
      headline: "Nothing to orient around yet.",
      detail:
        "Nothing declares itself as a way in, and no single file carries much more than the others. On a small or library-shaped repo that is a real answer, not a gap.",
    },
    {
      answer:
        doors.length + leaned.length === 0
          ? "There is no obvious place to start."
          : doors.length > 0
            ? `Start at ${doors.length} way${doors.length === 1 ? "" : "s"} into this project, then read the ${leaned.length} file${leaned.length === 1 ? "" : "s"} everything else runs through.`
            : `Nothing declares itself as a way in, so start with the ${leaned.length} file${leaned.length === 1 ? "" : "s"} everything else runs through.`,
      howToRead:
        "Read top to bottom — ways in first, then the files most of the project depends on, then the longest ones. Each row opens the map behind it.",
    },
  );
}
