// A capped list is not a total, and every surface that shows a number must
// come from the total.
//
// The panel shows the worst 15. That cap was harmless while repos produced 6
// and 8 groups; it became binding the moment file spread replaced the
// complexity floor, and four surfaces were still rendering the page size:
//
//   Overview card      "15 duplicate groups"  — /code said 37, one click away
//   headline           the count above the fold, and the CRITICAL-group search
//                      ran inside the slice, so a complexity-60 pair could be
//                      ranked out by sixteen forty-copy one-liners
//   structuralDiff     set-diffed two top-15 lists and reported groups
//                      "resolved" that a new higher-ranked group had displaced
//   MCP find_duplicates  groupCount: the page size, handed to an agent
//
// These are behavioural tests, not greps: each one builds a graph where the cap
// binds and asserts on what the surface actually produces. A rename cannot make
// them pass.

import { describe, it, expect } from "vitest";

import type { CodeGraph, FunctionDef } from "../codeAnalysis/types";
import {
  allDuplicateGroups,
  countDuplicateGroups,
  topDuplicateGroups,
} from "../codeAnalysis/duplicates";
import { pickHeadline } from "../intelligence/headline";
import { structuralDiff } from "../intelligence/structuralDiff";
import type { AnalysisSnapshot } from "../types";

const PANEL_PAGE = 15;

function fn(
  name: string,
  filePath: string,
  bodyHash: string,
  complexity = 4,
): FunctionDef {
  return { name, filePath, bodyHash, complexity, startRow: 1, endRow: 9 };
}

function emptyGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
  };
}

/** `count` two-file duplicate groups, plus any extras. Two files per group, so
 *  every group clears the spread floor. */
function graphWith(count: number, extra: FunctionDef[] = []): CodeGraph {
  const functions: FunctionDef[] = [];
  for (let i = 0; i < count; i++) {
    functions.push(fn(`f${i}a`, `src/a${i}.ts`, `h${i}`));
    functions.push(fn(`f${i}b`, `src/b${i}.ts`, `h${i}`));
  }
  return { ...emptyGraph(), functions: [...functions, ...extra] };
}

function snapshotOf(cg: CodeGraph): AnalysisSnapshot {
  return { codeGraph: cg } as unknown as AnalysisSnapshot;
}

describe("the page and the total are different numbers, and stay that way", () => {
  it("caps the page and does not cap the count", () => {
    const cg = graphWith(26);
    expect(topDuplicateGroups(cg)).toHaveLength(PANEL_PAGE);
    expect(countDuplicateGroups(cg)).toBe(26);
    expect(allDuplicateGroups(cg)).toHaveLength(26);
  });

  it("agrees when the cap does not bind", () => {
    const cg = graphWith(4);
    expect(topDuplicateGroups(cg)).toHaveLength(4);
    expect(countDuplicateGroups(cg)).toBe(4);
  });

  it("applies the same filters to both, so they can never disagree on WHICH", () => {
    // A count computed with different filters than the list is a subtler
    // version of the same bug: the reader can reconcile neither number.
    const cg = graphWith(3);
    const opts = { minComplexity: 99 };
    expect(topDuplicateGroups(cg, opts)).toEqual([]);
    expect(countDuplicateGroups(cg, opts)).toBe(0);
  });
});

describe("the headline states the repo's count, and can still see a small critical group", () => {
  it("does not print the page size", () => {
    // 20 ordinary groups plus one complexity-60 pair. The critical rung fires,
    // and the number in front of the reader must be 21, not 15.
    const cg = graphWith(20, [
      fn("megaParse", "src/one.ts", "critical", 60),
      fn("megaParse", "src/two.ts", "critical", 60),
    ]);
    const h = pickHeadline(snapshotOf(cg));
    expect(h.kind).toBe("critical-duplicates");
    expect(h.primary).toContain("21 duplicate groups");
    expect(h.primary, "printed the panel's page size").not.toContain("15 duplicate");
  });

  it("finds a critical group the sort ranks below the page", () => {
    // The trap: the sort key is groupSize x maxComplexity, so a 2-member
    // complexity-60 group scores 120 while sixteen 40-member complexity-5
    // groups score 200 each. Searching inside the top 15 misses it entirely
    // and the page falls through to a "looks healthy" headline.
    const noisy: FunctionDef[] = [];
    for (let g = 0; g < 16; g++) {
      for (let m = 0; m < 40; m++) {
        noisy.push(fn(`noise${g}_${m}`, `src/n${g}_${m}.ts`, `noise${g}`, 5));
      }
    }
    const cg: CodeGraph = {
      ...emptyGraph(),
      functions: [
        ...noisy,
        fn("megaParse", "src/one.ts", "critical", 60),
        fn("megaParse", "src/two.ts", "critical", 60),
      ],
    };

    // Precondition: the critical group really is off the page.
    const page = topDuplicateGroups(cg);
    expect(page.some((g) => g.maxComplexity >= 50)).toBe(false);
    expect(allDuplicateGroups(cg).some((g) => g.maxComplexity >= 50)).toBe(true);

    const h = pickHeadline(snapshotOf(cg));
    expect(h.kind, "the critical group was ranked off the page and lost").toBe(
      "critical-duplicates",
    );
    expect(h.primary).toContain("megaParse");
  });
});

describe("the since-last-visit diff does not invent refactors", () => {
  it("reports nothing resolved when nothing was resolved", () => {
    // 16 groups, then the same 16 plus one new group that outranks them all.
    // Comparing two top-15 lists drops the previous 16th and calls it
    // "dissolved" — a refactor the reader never did, in the panel whose whole
    // job is to say what changed.
    const prev = graphWith(16);
    const curr = graphWith(16, [
      fn("brandNew", "src/new1.ts", "hNEW", 99),
      fn("brandNew", "src/new2.ts", "hNEW", 99),
    ]);

    // Precondition: the cap binds on both sides.
    expect(countDuplicateGroups(prev)).toBe(16);
    expect(countDuplicateGroups(curr)).toBe(17);
    expect(topDuplicateGroups(curr)[0].hash).toBe("hNEW");

    // The counterfactual, computed here rather than asserted from memory: this
    // is exactly what the old code did, and it is why this fixture is a trap
    // and not just a passing test.
    const asItWas = {
      added: [...new Set(topDuplicateGroups(curr).map((g) => g.hash))].filter(
        (h) => !new Set(topDuplicateGroups(prev).map((g) => g.hash)).has(h),
      ).length,
      dissolved: [...new Set(topDuplicateGroups(prev).map((g) => g.hash))].filter(
        (h) => !new Set(topDuplicateGroups(curr).map((g) => g.hash)).has(h),
      ).length,
    };
    expect(asItWas.dissolved, "fixture does not reproduce the old bug").toBe(1);

    const diff = structuralDiff(snapshotOf(prev), snapshotOf(curr));
    expect(diff.duplicateGroupsAdded).toBe(1);
    expect(
      diff.duplicateGroupsDissolved,
      "reported a duplicate group resolved that was only pushed off the page",
    ).toBe(0);
  });

  it("still sees a group that genuinely went away", () => {
    // The guard above must not be satisfied by never reporting anything.
    const prev = graphWith(3);
    const curr = graphWith(2);
    const diff = structuralDiff(snapshotOf(prev), snapshotOf(curr));
    expect(diff.duplicateGroupsDissolved).toBe(1);
    expect(diff.duplicateGroupsAdded).toBe(0);
  });
});
