// Unit coverage for the pure symbol lookup behind the locate_symbol tool.

import { describe, it, expect } from "vitest";
import { locateSymbol } from "../tools/locateSymbol";
import type { CodeGraph, FunctionDef, ClassDef } from "../../lib/codeAnalysis/types";

function fn(
  p: Partial<FunctionDef> & { name: string; filePath: string; startRow: number }
): FunctionDef {
  return { endRow: p.startRow + 5, complexity: 1, ...p };
}
function cls(
  p: Partial<ClassDef> & { name: string; filePath: string; startRow: number }
): ClassDef {
  return { endRow: p.startRow + 10, fields: [], methods: [], ...p };
}
function graph(functions: FunctionDef[], classes: ClassDef[] = []): CodeGraph {
  return { functions, classes, calls: [], imports: [], fileComplexity: {}, filesByExt: {}, byPlugin: {} };
}

describe("locateSymbol", () => {
  it("returns a 1-indexed line (startRow + 1), fixing the off-by-one the agent guessed around", () => {
    // Tree-sitter row 434 == the line an editor calls 435.
    const cg = graph([fn({ name: "download", filePath: "lib/response.js", startRow: 434, complexity: 13 })]);
    const r = locateSymbol(cg, { symbol: "download" });
    expect(r.matchType).toBe("exact");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ file: "lib/response.js", line: 435, kind: "function", complexity: 13 });
  });

  it("tags a container-bearing definition as a method", () => {
    const cg = graph([fn({ name: "authenticate", filePath: "src/user.ts", startRow: 9, containerType: "UserService" })]);
    const r = locateSymbol(cg, { symbol: "authenticate" });
    expect(r.matches[0]).toMatchObject({ kind: "method", container: "UserService", line: 10 });
  });

  it("disambiguates same-named methods by container — arg and dotted form", () => {
    const cg = graph([
      fn({ name: "authenticate", filePath: "src/user.ts", startRow: 9, containerType: "UserService" }),
      fn({ name: "authenticate", filePath: "src/admin.ts", startRow: 19, containerType: "AdminService" }),
    ]);
    const viaArg = locateSymbol(cg, { symbol: "authenticate", container: "AdminService" });
    expect(viaArg.matches).toHaveLength(1);
    expect(viaArg.matches[0].file).toBe("src/admin.ts");

    const viaDot = locateSymbol(cg, { symbol: "UserService.authenticate" });
    expect(viaDot.matches).toHaveLength(1);
    expect(viaDot.matches[0].file).toBe("src/user.ts");
  });

  it("relaxes a container prefix that isn't a real class (the 'res.download' case)", () => {
    // JS: `res.download = function download(){}` → name "download", no containerType.
    const cg = graph([fn({ name: "download", filePath: "lib/response.js", startRow: 434, complexity: 13 })]);
    const strict = locateSymbol(cg, { symbol: "download", container: "res" });
    // 'res' matches no class, so it falls back to a name-only match rather than none.
    expect(strict.matchType).toBe("exact");
    expect(strict.containerRelaxed).toBe(true);
    expect(strict.matches[0]).toMatchObject({ file: "lib/response.js", line: 435 });

    // Dotted form of the same natural query.
    const dotted = locateSymbol(cg, { symbol: "res.download" });
    expect(dotted.matches[0].line).toBe(435);
    expect(dotted.containerRelaxed).toBe(true);
  });

  it("keeps only the exact tier — substring matches don't dilute an exact hit", () => {
    const cg = graph([
      fn({ name: "send", filePath: "lib/response.js", startRow: 100 }),
      fn({ name: "sendFile", filePath: "lib/response.js", startRow: 200 }),
    ]);
    const r = locateSymbol(cg, { symbol: "send" });
    expect(r.matchType).toBe("exact");
    expect(r.totalMatched).toBe(1);
    expect(r.matches.map((m) => m.symbol)).toEqual(["send"]);
  });

  it("falls back to case-insensitive, then fuzzy substring", () => {
    const ci = locateSymbol(graph([fn({ name: "Download", filePath: "a.ts", startRow: 0 })]), { symbol: "download" });
    expect(ci.matchType).toBe("case-insensitive");

    const fuzzy = locateSymbol(graph([fn({ name: "downloadFile", filePath: "a.ts", startRow: 0 })]), { symbol: "download" });
    expect(fuzzy.matchType).toBe("fuzzy");
    expect(fuzzy.matches[0].symbol).toBe("downloadFile");
  });

  it("returns matchType 'none' with no matches when the symbol is absent", () => {
    const r = locateSymbol(graph([fn({ name: "send", filePath: "a.ts", startRow: 0 })]), { symbol: "nonexistent" });
    expect(r).toMatchObject({ matchType: "none", totalMatched: 0, matches: [] });
  });

  it("finds class / interface / enum definitions with the right kind", () => {
    const cg = graph(
      [],
      [
        cls({ name: "UserService", filePath: "src/user.ts", startRow: 4 }),
        cls({ name: "Repo", filePath: "src/repo.ts", startRow: 0, isInterface: true }),
        cls({ name: "Color", filePath: "src/color.ts", startRow: 0, isEnum: true }),
      ]
    );
    expect(locateSymbol(cg, { symbol: "UserService" }).matches[0]).toMatchObject({ kind: "class", line: 5 });
    expect(locateSymbol(cg, { symbol: "Repo" }).matches[0].kind).toBe("interface");
    expect(locateSymbol(cg, { symbol: "Color" }).matches[0].kind).toBe("enum");
  });

  it("ranks the strongest definition first (complexity desc)", () => {
    const cg = graph([
      fn({ name: "handler", filePath: "a.ts", startRow: 0, complexity: 3 }),
      fn({ name: "handler", filePath: "b.ts", startRow: 0, complexity: 12 }),
    ]);
    const r = locateSymbol(cg, { symbol: "handler" });
    expect(r.matches.map((m) => m.file)).toEqual(["b.ts", "a.ts"]);
  });

  it("honours the kind filter", () => {
    const cg = graph(
      [fn({ name: "Thing", filePath: "a.ts", startRow: 0 })],
      [cls({ name: "Thing", filePath: "b.ts", startRow: 0 })]
    );
    expect(locateSymbol(cg, { symbol: "Thing", kind: "function" }).matches.map((m) => m.kind)).toEqual(["function"]);
    expect(locateSymbol(cg, { symbol: "Thing", kind: "class" }).matches.map((m) => m.kind)).toEqual(["class"]);
    expect(locateSymbol(cg, { symbol: "Thing", kind: "any" }).matches).toHaveLength(2);
  });
});
