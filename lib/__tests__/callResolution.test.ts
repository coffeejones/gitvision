import { describe, it, expect } from "vitest";
import type { CodeGraph, CallEdge } from "../codeAnalysis/types";
import { computeCallResolution } from "../codeAnalysis/callResolution";

function graph(calls: CallEdge[]): CodeGraph {
  return {
    functions: [],
    calls,
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
  } as unknown as CodeGraph;
}

function edge(over: Partial<CallEdge>): CallEdge {
  return {
    fromFile: "a.ts",
    fromFunction: "f",
    calleeName: "g",
    toFile: null,
    toFunction: null,
    ...over,
  } as CallEdge;
}

describe("computeCallResolution", () => {
  it("counts calls resolved to a target vs the total", () => {
    const cg = graph([
      edge({ toFile: "b.ts", toFunction: "g" }), // resolved
      edge({ toFile: "b.ts", toFunction: "h" }), // resolved
      edge({ toFile: null, toFunction: null }), // unresolved (dynamic dispatch)
      edge({ toFile: "b.ts", toFunction: null }), // half — NOT resolved
    ]);
    const r = computeCallResolution(cg);
    expect(r).toEqual({ resolved: 2, total: 4, rate: 0.5 });
  });

  it("is 0 (not NaN) when there are no calls", () => {
    expect(computeCallResolution(graph([]))).toEqual({ resolved: 0, total: 0, rate: 0 });
  });

  it("is 1 when every call resolved", () => {
    const cg = graph([edge({ toFile: "b.ts", toFunction: "g" })]);
    expect(computeCallResolution(cg)).toMatchObject({ resolved: 1, total: 1, rate: 1 });
  });
});
