// The call-resolution number a user is allowed to see.
//
// There are two rates and only one of them means anything.
//
//   pct     resolved / ALL call sites.  6-31% across the stored corpus.
//   ownPct  resolved / calls that name a function THIS REPO defines. 92-98%
//           on application-style code.
//
// The first is not an accuracy score and never was: most call edges in any real
// file point at libraries and language builtins — measured on this repo, 72% of
// all edges are names like `expect`, `it`, `map`, `push`, `Map`. Those SHOULD
// stay unresolved; there is no own-repo function to point them at. Judging the
// analyser on them is like scoring a dictionary by the words it omits.
//
// lib/codeAnalysis/flowTrace.ts has said so in its own header for a while —
// "undersells the analysis by roughly ten times" — while the Code tab rendered
// exactly that number. This moves the honest one into a single home so both
// surfaces read the same function rather than two implementations drifting.
//
// The evidence rules below are the valuable part, not the number. A name match
// alone is NOT evidence: `request.POST.get()` names `get`, and any Django repo
// defines a `get` somewhere. Counting name collisions scored pygoat at 25% when
// 74 of its 103 "misses" were dict and ORM calls the resolver was right to
// refuse.

import { describe, it, expect } from "vitest";
import { hasSessions } from "./helpers/sessionFixture";

import type { CodeGraph } from "../codeAnalysis/types";
import {
  computeCallResolution,
  computeOwnCallResolution,
} from "../codeAnalysis/callResolution";

function fn(filePath: string, name: string, containerType?: string) {
  return { filePath, name, containerType, complexity: 1, startRow: 0, endRow: 1 };
}

function graph(over: Partial<CodeGraph>): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "",
    ...over,
  } as CodeGraph;
}

/** A resolved call: the resolver found a definition. */
const hit = (fromFile: string, fromFunction: string, calleeName: string, toFile: string) => ({
  fromFile,
  fromFunction,
  calleeName,
  toFile,
  toFunction: calleeName,
});

/** An unresolved call. `over` carries the receiver evidence. */
const miss = (
  fromFile: string,
  fromFunction: string,
  calleeName: string,
  over: Record<string, unknown> = {},
) => ({ fromFile, fromFunction, calleeName, toFile: null, toFunction: null, ...over });

describe("computeOwnCallResolution", () => {
  it("ignores calls into libraries entirely", () => {
    // The whole point. A repo that resolves everything it could is at 100%,
    // however many library calls it makes — and the overall rate says 33%.
    const cg = graph({
      functions: [fn("src/a.ts", "ours")],
      calls: [
        hit("src/a.ts", "caller", "ours", "src/a.ts"),
        miss("src/a.ts", "caller", "map"),
        miss("src/a.ts", "caller", "push"),
      ] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownResolved: 1, ownMissed: 0, ownPct: 100 });
    expect(Math.round(computeCallResolution(cg).rate * 100)).toBe(33);
  });

  it("counts a bare call naming our own function as a miss", () => {
    // No receiver + the name is one we define = it was ours and we failed.
    const cg = graph({
      functions: [fn("src/a.ts", "ours"), fn("src/b.ts", "other")],
      calls: [
        hit("src/a.ts", "caller", "ours", "src/a.ts"),
        miss("src/b.ts", "caller", "other"),
      ] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownResolved: 1, ownMissed: 1, ownPct: 50 });
  });

  it("does NOT count an untyped receiver, even when the name matches", () => {
    // `request.POST.get()` names `get`. So does our own `get`. Without a type
    // on the receiver there is no evidence, and guessing here is what scored
    // pygoat at 25% — four times too harsh.
    const cg = graph({
      functions: [fn("src/a.ts", "get")],
      calls: [miss("src/a.ts", "caller", "get", { hasReceiver: true })] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownResolved: 0, ownMissed: 0, ownTotal: 0 });
  });

  it("DOES count a receiver typed as a class we define", () => {
    // That one really should have resolved.
    const cg = graph({
      functions: [fn("src/a.ts", "save", "Repo")],
      calls: [
        miss("src/a.ts", "caller", "save", { hasReceiver: true, calleeType: "Repo" }),
      ] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownMissed: 1, ownPct: 0 });
  });

  it("does not count a receiver typed as somebody else's class", () => {
    const cg = graph({
      functions: [fn("src/a.ts", "save", "Repo")],
      calls: [
        miss("src/a.ts", "caller", "save", { hasReceiver: true, calleeType: "SomeLibClass" }),
      ] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownMissed: 0, ownTotal: 0 });
  });

  it("counts resolved and missed on the SAME population", () => {
    // An asymmetric count inflates the score. Tests are excluded from both
    // sides by default: a test calling a plugin-interface method that exists
    // once per plugin is ambiguous by construction, not a defect.
    const cg = graph({
      functions: [fn("src/a.ts", "ours")],
      calls: [
        hit("src/a.test.ts", "spec", "ours", "src/a.ts"),
        miss("src/a.test.ts", "spec", "ours"),
      ] as CodeGraph["calls"],
    });
    const r = computeOwnCallResolution(cg);
    expect(r.ownResolved, "a test caller counted on the resolved side").toBe(0);
    expect(r.ownMissed, "a test caller counted on the missed side").toBe(0);
  });

  it("includes tests on both sides when asked to", () => {
    const cg = graph({
      functions: [fn("src/a.ts", "ours")],
      calls: [
        hit("src/a.test.ts", "spec", "ours", "src/a.ts"),
        miss("src/a.test.ts", "spec", "ours"),
      ] as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg, { excludeTests: false })).toMatchObject({
      ownResolved: 1,
      ownMissed: 1,
    });
  });

  it("reports 0 rather than NaN when the repo has no own calls at all", () => {
    expect(computeOwnCallResolution(graph({}))).toMatchObject({ ownTotal: 0, ownPct: 0 });
  });

  it("ignores a call with no containing function", () => {
    // Module-scope calls have no `fromFunction` and cannot be attributed.
    const cg = graph({
      functions: [fn("src/a.ts", "ours")],
      calls: [
        { fromFile: "src/a.ts", calleeName: "ours", toFile: null, toFunction: null },
      ] as unknown as CodeGraph["calls"],
    });
    expect(computeOwnCallResolution(cg)).toMatchObject({ ownTotal: 0 });
  });
});

describe("one implementation, two callers", () => {
  it("buildFlowIndex reports exactly what the standalone reports", async () => {
    // The two used to be the same arithmetic written twice. That is how the
    // critical-count bug survived in two files at once; this pins that the
    // flow index delegates rather than re-deriving.
    const { buildFlowIndex } = await import("../codeAnalysis/flowTrace");
    const cg = graph({
      functions: [fn("src/a.ts", "ours"), fn("src/b.ts", "other", "Repo")],
      calls: [
        hit("src/a.ts", "caller", "ours", "src/a.ts"),
        miss("src/b.ts", "caller", "other"),
        miss("src/b.ts", "caller", "save", { hasReceiver: true, calleeType: "Repo" }),
        miss("src/a.ts", "caller", "map"),
      ] as CodeGraph["calls"],
    });
    const standalone = computeOwnCallResolution(cg);
    const viaIndex = buildFlowIndex(cg).resolution;
    expect(viaIndex.ownResolved).toBe(standalone.ownResolved);
    expect(viaIndex.ownMissed).toBe(standalone.ownMissed);
    expect(viaIndex.ownPct).toBe(standalone.ownPct);
  });

  it.skipIf(!hasSessions("yAwwHY_ShB"))("agrees on a real session, not just a fixture", async () => {
    const { buildFlowIndex } = await import("../codeAnalysis/flowTrace");
    const { loadSnapshot } = await import("./helpers/sessionFixture");
    // Resolved through the shared helper — a relative path here only worked
    // when the suite ran from the main checkout, never from a worktree.
    const cg = loadSnapshot<{ codeGraph: CodeGraph }>("yAwwHY_ShB").codeGraph;
    expect(cg.calls.length).toBeGreaterThan(1000);
    expect(computeOwnCallResolution(cg).ownPct).toBe(buildFlowIndex(cg).resolution.ownPct);
  });
});
