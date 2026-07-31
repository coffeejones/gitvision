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

describe("matches inside string literals are not findings", () => {
  // Every finding this scanner produced on our own repository was one of
  // these: the word eval( inside a quoted string. Three were this scanner's
  // OWN rule names, one was a mock security finding in the landing's showcase.
  // Five findings, five false positives, on the codebase we know best.
  const ids = (path: string, content: string) =>
    scanForRiskyPatterns([file(path, content)]).findings.map((f) => f.patternId);

  it("does not flag the scanner's own rule names", () => {
    // Verbatim from lib/security/riskyPatterns.ts, which the scanner scans.
    expect(ids("lib/security/riskyPatterns.ts", '    name: "eval() call",\n')).toEqual([]);
    expect(
      ids("lib/security/riskyPatterns.ts", '    name: "new Function() constructor",\n'),
    ).toEqual([]);
  });

  it("does not flag a mock finding in a UI fixture", () => {
    // Shape taken from components/landing/codetrawl/CTShowcaseMocks.tsx:214.
    const line =
      '  { sev: "info", kind: "pattern", loc: "tasks/runner.py:88", rule: "eval() call" },\n';
    expect(ids("components/landing/codetrawl/CTShowcaseMocks.tsx", line)).toEqual([]);
  });

  it("still flags a real call on a line that also contains a string", () => {
    // The quotes CLOSE before the call, so this is code, not a literal. The
    // check has to be stateful rather than "is there a quote earlier".
    expect(ids("app.js", 'const label = "run"; eval(payload);\n')).toEqual(["js-eval"]);
  });

  it("is not fooled by an apostrophe inside a double-quoted string", () => {
    // A naive odd/even quote count would see the ' in "it's" and decide the
    // eval below is inside a string.
    expect(ids("app.js", 'const msg = "it\'s fine";\neval(payload);\n')).toEqual([
      "js-eval",
    ]);
  });

  it("handles an escaped quote without losing track", () => {
    expect(ids("app.js", 'const s = "a \\" b"; eval(x);\n')).toEqual(["js-eval"]);
  });

  it("still flags Python exec outside a string", () => {
    expect(ids("app.py", 'label = "exec() call"\nexec(code)\n')).toEqual(["py-exec"]);
  });
});
