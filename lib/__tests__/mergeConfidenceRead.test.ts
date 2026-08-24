// Tests for the Merge Confidence engine (The Read — Mode B). We build minimal
// synthetic CodeGraphs with a known base->head diff and assert the read level,
// the orange-rationing rule (criticalFnKey only on HIGH BLAST), and the
// removed-function-with-callers path. Pure — no sessions, no I/O.

import { describe, it, expect } from "vitest";
import { computeMergeConfidenceRead } from "../intelligence/mergeConfidenceRead";
import type { CodeGraph, FunctionDef, CallEdge } from "../codeAnalysis/types";

function fn(
  filePath: string,
  name: string,
  complexity: number,
  bodyHash?: string
): FunctionDef {
  return { filePath, name, startRow: 1, endRow: 9, complexity, bodyHash };
}

function callTo(
  fromFile: string,
  fromFunction: string,
  toFile: string,
  toFunction: string
): CallEdge {
  return { fromFile, fromFunction, calleeName: toFunction, toFile, toFunction };
}

function graph(functions: FunctionDef[], calls: CallEdge[]): CodeGraph {
  return {
    functions,
    calls,
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
  };
}

/** N distinct prod callers (in `callerFile`) that each call target T. Returns
 *  the caller FunctionDefs + the call edges. */
function callers(
  callerFile: string,
  targetFile: string,
  targetName: string,
  n: number
): { fns: FunctionDef[]; calls: CallEdge[] } {
  const fns: FunctionDef[] = [];
  const calls: CallEdge[] = [];
  for (let i = 0; i < n; i++) {
    fns.push(fn(callerFile, `caller${i}`, 1));
    calls.push(callTo(callerFile, `caller${i}`, targetFile, targetName));
  }
  return { fns, calls };
}

describe("computeMergeConfidenceRead", () => {
  it("returns SAFE TO MERGE with no riskiest when nothing changed", () => {
    const g = graph([fn("a.ts", "x", 3, "h1")], []);
    const r = computeMergeConfidenceRead(g, g);
    expect(r.read).toBe("SAFE TO MERGE");
    expect(r.riskiest).toHaveLength(0);
    expect(r.criticalFnKey).toBeUndefined();
    expect(r.headline).toMatch(/no function-level changes/i);
  });

  it("HIGH BLAST when a modified untested function has many callers", () => {
    const c = callers("core/uses.ts", "core/risky.ts", "risky", 12);
    const base = graph([fn("core/risky.ts", "risky", 5, "old"), ...c.fns], c.calls);
    const head = graph([fn("core/risky.ts", "risky", 9, "new"), ...c.fns], c.calls);
    const r = computeMergeConfidenceRead(base, head);
    expect(r.read).toBe("HIGH BLAST");
    expect(r.riskiest[0].name).toBe("risky");
    expect(r.riskiest[0].callers).toBe(12);
    expect(r.riskiest[0].untested).toBe(true);
    // Orange is rationed: a critical function only on HIGH BLAST.
    expect(r.criticalFnKey).toBe(r.riskiest[0].key);
  });

  it("SAFE TO MERGE for a small tested change with no orange", () => {
    const callEdge = callTo("util/uses.ts", "u0", "util/small.ts", "small");
    const testCall = callTo("util/small.test.ts", "t0", "util/small.ts", "small");
    const fns = [
      fn("util/small.ts", "small", 2, "old"),
      fn("util/uses.ts", "u0", 1),
      fn("util/small.test.ts", "t0", 1),
    ];
    const base = graph(fns, [callEdge, testCall]);
    const head = graph(
      [fn("util/small.ts", "small", 3, "new"), fns[1], fns[2]],
      [callEdge, testCall]
    );
    const r = computeMergeConfidenceRead(base, head);
    expect(r.read).toBe("SAFE TO MERGE");
    expect(r.criticalFnKey).toBeUndefined();
    expect(r.riskiest[0].untested).toBe(false); // a test file calls it
  });

  it("REVIEW CLOSELY (no orange) for a mid-blast untested change", () => {
    const c = callers("svc/uses.ts", "svc/mid.ts", "mid", 4);
    const base = graph([fn("svc/mid.ts", "mid", 2, "old"), ...c.fns], c.calls);
    const head = graph([fn("svc/mid.ts", "mid", 4, "new"), ...c.fns], c.calls);
    const r = computeMergeConfidenceRead(base, head);
    expect(r.read).toBe("REVIEW CLOSELY");
    // 4 callers is below the HIGH threshold — no critical/orange function.
    expect(r.criticalFnKey).toBeUndefined();
  });

  it("HIGH BLAST when a removed function still has direct callers", () => {
    const c = callers("api/uses.ts", "api/legacy.ts", "legacy", 4);
    const base = graph([fn("api/legacy.ts", "legacy", 5, "old"), ...c.fns], c.calls);
    // head drops `legacy` entirely; the callers remain.
    const head = graph([...c.fns], []);
    const r = computeMergeConfidenceRead(base, head);
    expect(r.read).toBe("HIGH BLAST");
    expect(r.riskiest[0].name).toBe("legacy");
    expect(r.riskiest[0].status).toBe("removed");
    expect(r.criticalFnKey).toBe(r.riskiest[0].key);
  });
});

// What the card claims, versus what it measured.
//
// All of this came from one real report on a Java school project
// (coffeejones/JavaWorkshopTest#7). The row read:
//
//   Dish.price · added
//     6 callers · 2 cross-module · cx 1 · no test reaches it
//
// and every part of it was misleading at once. `callers` was transitive fan-in
// to three hops while `untested` was direct-only, so "6 callers" and "no test
// reaches it" were answers to different questions printed as one sentence — and
// two of those six callers were the tests. Two of the six list rows were JUnit
// methods with "0 callers · test-covered", a label they get by omission because
// computeTestCoverage never puts a test file in untestedHotspots. And the
// function genuinely WAS asserted by five tests; the Java plugin just could not
// type `Dish.FESTIVALBURGER.price()`.
describe("the merge card does not mix two measurements into one claim", () => {
  const testFile = "src/test/java/dk/zealand/DishTest.java";
  const prodFile = "src/main/java/dk/zealand/Dish.java";

  it("keeps test methods off the risk list entirely", () => {
    // Every term in the score is meaningless for a test method: reflectively
    // invoked so always 0 callers, and never in untestedHotspots so always
    // "test-covered". They displaced real rows on a six-slot list.
    const base = graph([fn(prodFile, "price", 1, "h1")], []);
    const head = graph(
      [
        fn(prodFile, "price", 2, "h2"),
        fn(testFile, "everyDishHasAPositivePrice", 2, "t1"),
        fn(testFile, "veganskBowlCosts65", 1, "t2"),
      ],
      [],
    );
    const r = computeMergeConfidenceRead(base, head);
    expect(r.riskiest.map((x) => x.name)).toEqual(["price"]);
    expect(
      r.riskiest.some((x) => x.filePath.includes("/test/")),
      "a JUnit method is being scored as a merge risk",
    ).toBe(false);
  });

  it("counts only production functions in the reassurance line", () => {
    // "10 of 11 analyzed functions look low-risk" counted seven test methods
    // in the denominator.
    const base = graph([fn(prodFile, "price", 1, "h1")], []);
    const head = graph(
      [
        fn(prodFile, "price", 2, "h2"),
        fn(testFile, "a", 1, "t1"),
        fn(testFile, "b", 1, "t2"),
        fn(testFile, "c", 1, "t3"),
      ],
      [],
    );
    expect(computeMergeConfidenceRead(base, head).safeParts).toContain("of 1 analyzed");
  });

  it("does not tell someone who only wrote tests that nothing changed", () => {
    // The filter above makes a tests-only PR land in the empty branch, and the
    // old headline there would have been a worse lie than the padding.
    const base = graph([fn(prodFile, "price", 1, "h1")], []);
    const head = graph(
      [fn(prodFile, "price", 1, "h1"), fn(testFile, "newTest", 1, "t1")],
      [],
    );
    const r = computeMergeConfidenceRead(base, head);
    expect(r.riskiest).toEqual([]);
    expect(r.headline).toContain("Only test code changed");
    expect(r.headline).not.toContain("No function-level changes");
  });

  it("still says nothing changed when nothing changed", () => {
    const g = graph([fn(prodFile, "price", 1, "h1")], []);
    expect(computeMergeConfidenceRead(g, g).headline).toContain(
      "No function-level changes",
    );
  });

  it("separates direct callers from transitive reach", () => {
    // One direct caller, reached by more further out. The card must be able to
    // say which is which; printing only the transitive number is what made
    // "6 callers · no test reaches it" read as a contradiction.
    const base = graph([fn(prodFile, "price", 1, "h0")], []);
    const head = graph(
      [
        fn(prodFile, "price", 1, "h1"),
        fn("src/main/java/dk/zealand/Main.java", "menuLine", 1),
        fn("src/main/java/dk/zealand/Main.java", "showDishes", 1),
      ],
      [
        callTo("src/main/java/dk/zealand/Main.java", "menuLine", prodFile, "price"),
        callTo(
          "src/main/java/dk/zealand/Main.java",
          "showDishes",
          "src/main/java/dk/zealand/Main.java",
          "menuLine",
        ),
      ],
    );
    const row = computeMergeConfidenceRead(base, head).riskiest.find(
      (x) => x.name === "price",
    )!;
    expect(row.directCallers).toBe(1);
    expect(row.callers).toBeGreaterThan(row.directCallers);
  });

  it("withholds 'no test reaches it' when a test calls the name unresolved", () => {
    // THE one. Five tests assert Dish.price()'s exact values through
    // `Dish.FESTIVALBURGER.price()`, which the Java plugin cannot type — the
    // edges land with toFile null. Coverage skips them and the card announced
    // the function untested. A resolver gap must cost an unknown.
    const base = graph([fn(prodFile, "price", 1, "h0")], []);
    const head = graph(
      [fn(prodFile, "price", 1, "h1"), fn(testFile, "festivalburgerCosts59", 1)],
      [
        // Unresolved: the plugin saw the call and could not place it.
        {
          fromFile: testFile,
          fromFunction: "festivalburgerCosts59",
          calleeName: "price",
          toFile: null,
          toFunction: null,
        } as unknown as CallEdge,
      ],
    );
    const row = computeMergeConfidenceRead(base, head).riskiest.find(
      (x) => x.name === "price",
    )!;
    expect(row.untested, "coverage still has no evidence, and says so").toBe(true);
    expect(row.coverageUnknown, "but we cannot claim nothing tests it").toBe(true);
  });

  it("still says 'no test reaches it' when nothing named it from a test", () => {
    // The guard must not swallow the real finding. On the same report,
    // Main.showDishes is genuinely untested and no test mentions the name.
    const mainFile = "src/main/java/dk/zealand/Main.java";
    const base = graph([fn(mainFile, "showDishes", 1, "h0")], []);
    const head = graph(
      [fn(mainFile, "showDishes", 2, "h1"), fn(testFile, "somethingElse", 1)],
      [
        {
          fromFile: testFile,
          fromFunction: "somethingElse",
          calleeName: "assertTrue",
          toFile: null,
          toFunction: null,
        } as unknown as CallEdge,
      ],
    );
    const row = computeMergeConfidenceRead(base, head).riskiest.find(
      (x) => x.name === "showDishes",
    )!;
    expect(row.untested).toBe(true);
    expect(row.coverageUnknown, "doubt must be specific, not blanket").toBe(false);
  });

  it("does not claim doubt about a function a test really reaches", () => {
    const mainFile = "src/main/java/dk/zealand/Main.java";
    const base = graph([fn(mainFile, "menuLine", 1, "h0")], []);
    const head = graph(
      [fn(mainFile, "menuLine", 1, "h1"), fn(testFile, "t", 1)],
      [callTo(testFile, "t", mainFile, "menuLine")],
    );
    const row = computeMergeConfidenceRead(base, head).riskiest.find(
      (x) => x.name === "menuLine",
    )!;
    expect(row.untested).toBe(false);
    expect(row.coverageUnknown).toBe(false);
  });

  it("reports how many rows actually crossed a rule", () => {
    // Six rows under "Riskiest changes" imply six risks. The heading switches
    // on this number.
    const base = graph([fn(prodFile, "price", 1, "h0")], []);
    const head = graph([fn(prodFile, "price", 1, "h1")], []);
    const r = computeMergeConfidenceRead(base, head);
    expect(r.riskiest.length).toBe(1);
    expect(r.flaggedCount, "one trivial edit is not a risk").toBe(0);
  });
});
