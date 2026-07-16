import { describe, it, expect } from "vitest";
import { fuzzyScore, searchSources, type SearchSymbol } from "../symbolSearch";

describe("fuzzyScore", () => {
  it("ranks exact > prefix > substring > subsequence", () => {
    const exact = fuzzyScore("signals.ts", "signals.ts")!;
    const prefix = fuzzyScore("sig", "signals.ts")!;
    const substr = fuzzyScore("nals", "signals.ts")!;
    const subseq = fuzzyScore("sgl", "signals.ts")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(subseq);
  });

  it("returns null when not even a subsequence", () => {
    expect(fuzzyScore("xyz", "signals")).toBeNull();
    expect(fuzzyScore("zzz", "abc")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("SIG", "signals.ts")).toBe(fuzzyScore("sig", "signals.ts"));
  });

  it("rewards a word-boundary substring over a mid-word one", () => {
    const boundary = fuzzyScore("signals", "lib/signals.ts")!; // after '/'
    const midword = fuzzyScore("ignals", "designals.ts")!; // mid-word
    expect(boundary).toBeGreaterThan(midword);
  });

  it("empty query is not a match", () => {
    expect(fuzzyScore("", "anything")).toBeNull();
  });
});

describe("searchSources", () => {
  const files = ["lib/signals.ts", "lib/graph.ts", "app/page.tsx", "lib/sub/signalUtils.ts"];
  const symbols: SearchSymbol[] = [
    { name: "extractSignals", path: "lib/signals.ts", line: 8 },
    { name: "buildGraph", path: "lib/graph.ts", line: 40 },
    { name: "", path: "lib/anon.ts", line: 1 }, // anonymous — never searchable
  ];

  it("returns nothing for an empty query", () => {
    expect(searchSources("   ", files, symbols)).toEqual([]);
  });

  it("finds files by basename and symbols by name, best first", () => {
    const r = searchSources("signal", files, symbols);
    expect(r.length).toBeGreaterThan(0);
    // Every result actually matched.
    expect(r.every((x) => x.primary.toLowerCase().includes("signal"))).toBe(true);
    // Both kinds surface for "signal".
    expect(r.some((x) => x.kind === "file")).toBe(true);
    expect(r.some((x) => x.kind === "symbol")).toBe(true);
  });

  it("carries the definition line on symbol results, not file results", () => {
    const sym = searchSources("extractSignals", files, symbols).find((x) => x.kind === "symbol");
    expect(sym).toMatchObject({ path: "lib/signals.ts", line: 8 });
    const file = searchSources("graph.ts", files, symbols).find((x) => x.kind === "file");
    expect(file?.line).toBeUndefined();
  });

  it("never returns an anonymous ('') symbol", () => {
    const r = searchSources("a", files, symbols); // 'a' subsequences everything
    expect(r.some((x) => x.kind === "symbol" && x.primary === "")).toBe(false);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 200 }, (_, i) => `lib/file${i}.ts`);
    expect(searchSources("file", many, [], 10)).toHaveLength(10);
  });
});
