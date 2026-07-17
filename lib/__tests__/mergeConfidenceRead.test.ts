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
