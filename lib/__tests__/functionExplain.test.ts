import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildFunctionSignals,
  sliceFunctionSource,
  explainFunction,
} from "../functionExplain";
import type { FnMarker, FileChips } from "../sourceAnnotations";
import {
  explainCacheKey,
  getCachedExplanation,
  setCachedExplanation,
  _resetExplainCacheForTest,
} from "../functionExplainCache";
import type { FunctionExplanation } from "../functionExplain";

const MARKER: FnMarker = {
  name: "load",
  startRow: 4,
  endRow: 40,
  complexity: 16,
  changed: "modified",
  duplicates: [{ path: "b.ts", line: 11 }],
  callers: [
    { path: "a.ts", line: 1, fn: "useCore" },
    { path: "b.ts", line: null, fn: null },
  ],
};

const CHIPS: FileChips = {
  isTest: false,
  tier: "load-bearing",
  tested: false,
  fanIn: 5,
  untestedDependents: 2,
  complexity: 18,
  duplicatedFns: 1,
  churn: 42,
  authors: 1,
};

describe("buildFunctionSignals", () => {
  it("reshapes a marker + its file chips into the flat signal set", () => {
    expect(buildFunctionSignals("src/core.ts", MARKER, CHIPS)).toEqual({
      path: "src/core.ts",
      name: "load",
      line: 5, // startRow + 1
      complexity: 16,
      changed: "modified",
      duplicateCount: 1,
      callerCount: 2,
      fileTier: "load-bearing",
      fileTested: false,
      fileFanIn: 5,
      churn: 42,
      soloAuthor: true,
    });
  });

  it("falls back for an anonymous function and missing chips", () => {
    const s = buildFunctionSignals(
      "x.ts",
      { name: "", startRow: 0, endRow: 3, complexity: 9 },
      null,
    );
    expect(s).toMatchObject({
      name: "(anonymous)",
      line: 1,
      changed: null,
      duplicateCount: 0,
      callerCount: 0,
      fileTier: null,
      fileTested: null,
      fileFanIn: 0,
      churn: null,
      soloAuthor: false,
    });
  });

  it("only flags soloAuthor when authors === 1", () => {
    expect(buildFunctionSignals("x.ts", MARKER, { ...CHIPS, authors: 3 }).soloAuthor).toBe(false);
    expect(buildFunctionSignals("x.ts", MARKER, { ...CHIPS, authors: null }).soloAuthor).toBe(false);
  });
});

describe("sliceFunctionSource", () => {
  const file = ["l0", "l1", "l2", "l3", "l4"].join("\n");

  it("slices the function's row span inclusive (0-indexed rows)", () => {
    expect(sliceFunctionSource(file, { name: "f", startRow: 1, endRow: 3, complexity: 5 })).toBe(
      "l1\nl2\nl3",
    );
  });

  it("clamps an out-of-range end row to the file length", () => {
    expect(sliceFunctionSource(file, { name: "f", startRow: 3, endRow: 999, complexity: 5 })).toBe(
      "l3\nl4",
    );
  });

  it("truncates a pathologically long function and marks it", () => {
    const big = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
    const out = sliceFunctionSource(big, { name: "f", startRow: 0, endRow: 899, complexity: 5 });
    expect(out).toContain("(function truncated for length)");
    expect(out.split("\n").length).toBeLessThan(900);
  });
});

describe("explainFunction", () => {
  const origKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("returns null (feature disabled) when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const signals = buildFunctionSignals("x.ts", MARKER, CHIPS);
    expect(await explainFunction("source", signals, "ts")).toBeNull();
  });
});

describe("functionExplainCache", () => {
  beforeEach(() => _resetExplainCacheForTest());

  const sample: FunctionExplanation = {
    does: "does x",
    risk: "risky",
    suggestion: null,
    model: "claude-haiku-4-5",
    generatedAt: "2026-07-16T00:00:00.000Z",
    usage: { inputTokens: 1, outputTokens: 1 },
  };

  const SIG = buildFunctionSignals("a.ts", MARKER, CHIPS);

  it("keys by session + path + line + file hash + signals digest", () => {
    const key = explainCacheKey({ sessionId: "s1", path: "a.ts", line: 5, fileHash: "H", signals: SIG });
    expect(key.startsWith("s1:a.ts:5:H:")).toBe(true);
  });

  it("stores and reads back by key; misses return null", () => {
    const key = explainCacheKey({ sessionId: "s1", path: "a.ts", line: 5, fileHash: "H", signals: SIG });
    expect(getCachedExplanation(key)).toBeNull();
    setCachedExplanation(key, sample);
    expect(getCachedExplanation(key)).toEqual(sample);
  });

  it("a different file hash is a different key (the file's bytes changed)", () => {
    const base = { sessionId: "s1", path: "a.ts", line: 5, signals: SIG };
    setCachedExplanation(explainCacheKey({ ...base, fileHash: "H1" }), sample);
    expect(getCachedExplanation(explainCacheKey({ ...base, fileHash: "H2" }))).toBeNull();
  });

  it("different signals (e.g. new fan-in) is a different key even at the same bytes", () => {
    const base = { sessionId: "s1", path: "a.ts", line: 5, fileHash: "H" };
    setCachedExplanation(explainCacheKey({ ...base, signals: SIG }), sample);
    const moved = { ...SIG, callerCount: SIG.callerCount + 1 };
    expect(getCachedExplanation(explainCacheKey({ ...base, signals: moved }))).toBeNull();
  });

  it("evicts the oldest entry once past the cap", () => {
    for (let i = 0; i < 520; i++) {
      setCachedExplanation(`s:ref:f:${i}`, sample);
    }
    // The earliest inserts were evicted; the latest survive.
    expect(getCachedExplanation("s:ref:f:0")).toBeNull();
    expect(getCachedExplanation("s:ref:f:519")).toEqual(sample);
  });
});
