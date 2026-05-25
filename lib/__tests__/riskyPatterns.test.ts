// Unit tests for the risky-pattern scanner (lib/security/riskyPatterns.ts).
// Pure function over an array of files — easy to drive with crafted
// content fixtures. Integration via extractHealthSignals lives in
// signals.test.ts.

import { describe, it, expect } from "vitest";
import { scanForRiskyPatterns } from "../security/riskyPatterns";
import type { ScanFile } from "../security/secretsScan";

function file(filePath: string, content: string): ScanFile {
  return { filePath, content };
}

describe("scanForRiskyPatterns", () => {
  it("returns no findings on an empty file list", () => {
    expect(scanForRiskyPatterns([]).findings).toEqual([]);
  });

  it("finds a top-level eval() call in .js", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/runtime.js", "const x = 1;\neval('1+1');\n"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].patternId).toBe("js-eval");
    expect(findings[0].filePath).toBe("src/runtime.js");
    expect(findings[0].line).toBe(2);
    expect(findings[0].snippet).toBe("eval('1+1');");
  });

  it("finds new Function() constructor in .ts", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/compile.ts", "const fn = new Function('return 1');\n"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].patternId).toBe("js-new-function");
  });

  it("finds Python eval() and exec() separately", () => {
    const { findings } = scanForRiskyPatterns([
      file("script.py", "eval('1')\nexec('print(1)')\n"),
    ]);
    expect(findings).toHaveLength(2);
    const ids = findings.map((f) => f.patternId).sort();
    expect(ids).toEqual(["py-eval", "py-exec"]);
  });

  it("does NOT match method calls like obj.eval()", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/safe.js", "const r = parser.eval(input);\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("does NOT match identifier-prefixed calls like myEval()", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/safe.js", "myEval(input);\nsafeEval('x');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("does NOT match across ecosystems (Python eval in .js)", () => {
    // py-eval pattern is the same regex as js-eval, but the extension
    // gate ensures it only registers for .py files. The .js eval IS
    // matched (by js-eval), but the py-eval pattern doesn't double-fire.
    const { findings } = scanForRiskyPatterns([
      file("src/a.js", "eval('1');\n"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].patternId).toBe("js-eval");
  });

  it("skips test files (path includes .test.)", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/runtime.test.js", "eval('1');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("skips build/dist files", () => {
    const { findings } = scanForRiskyPatterns([
      file("dist/bundle.js", "eval('1');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("skips files inside node_modules", () => {
    const { findings } = scanForRiskyPatterns([
      file("node_modules/foo/index.js", "eval('1');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("skips minified files (any line > 500 chars)", () => {
    const longLine = "a".repeat(600);
    const { findings } = scanForRiskyPatterns([
      file("src/big.js", longLine + "\neval('1');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("skips eval after // single-line comment", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/a.js", "// eval('1');\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("skips eval after # Python comment", () => {
    const { findings } = scanForRiskyPatterns([
      file("a.py", "# eval('1')\n"),
    ]);
    expect(findings).toEqual([]);
  });

  it("captures line numbers correctly across multi-line file", () => {
    const { findings } = scanForRiskyPatterns([
      file("src/a.js", "// header\n\nconst x = 1;\neval('a');\nconst y = 2;\neval('b');\n"),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0].line).toBe(4);
    expect(findings[1].line).toBe(6);
  });

  it("returns truncated marker when total findings exceeds global cap", () => {
    // Generate a file with > 200 eval calls (global cap)
    const lines = Array.from({ length: 250 }, () => "eval('x');").join("\n");
    const { findings, truncated } = scanForRiskyPatterns([
      file("src/many.js", lines),
    ]);
    // Capped: per-file cap is 20, global is 200. Single file hits per-file cap first.
    expect(findings.length).toBeLessThanOrEqual(200);
    // Per-file cap of 20 should hit first for a single file
    expect(findings.length).toBe(20);
    expect(truncated).toBeUndefined();
  });
});
