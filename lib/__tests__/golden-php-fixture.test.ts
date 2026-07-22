// Golden PHP fixture — top-level functions, class methods, require_once,
// cross-file call resolution.

import { describe, it, expect, beforeAll } from "vitest";
import { phpPlugin } from "../codeAnalysis/plugins/php";
import { parseFile } from "../codeAnalysis/parse";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras: new Map() };
}

const HELPER_PHP = `<?php

function add($a, $b) {
    return $a + $b;
}

function safeDiv($a, $b) {
    if ($b == 0) {
        return null;
    }
    return $a / $b;
}
`;

const MAIN_PHP = `<?php
require_once 'helper.php';

class Calculator {
    public function process($items) {
        $total = 0;
        foreach ($items as $item) {
            if ($item > 0) {
                $total = add($total, $item);
            } elseif ($item < 0) {
                $total = safeDiv($total, -$item);
            }
        }
        return $total;
    }
}
`;

// HAND-COUNTED:
// helper.php:
//   add       → no decisions    → complexity 1
//   safeDiv   → 1 if            → complexity 2
// main.php:
//   Calculator.process → foreach + if + elseif → complexity 4

describe("golden PHP fixture", () => {
  beforeAll(async () => {
    await phpPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = { rel: "src/helper.php", ext: "php", content: HELPER_PHP };
    const main: SourceFile = { rel: "src/main.php", ext: "php", content: MAIN_PHP };
    const ix = makeIndex([helper, main]);
    const ph = parseFile(phpPlugin, helper, ix);
    const pm = parseFile(phpPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [ph, pm],
      pluginByFile: new Map([
        ["src/helper.php", "php"],
        ["src/main.php", "php"],
      ]),
    });
  }

  it("extracts exactly 3 functions/methods", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("function names include add, safeDiv, process", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["add", "process", "safeDiv"]);
  });

  it("class method process has Calculator as containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.containerType).toBe("Calculator");
  });

  it("top-level function add has no containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.containerType).toBeUndefined();
  });

  it("complexity of add is 1", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.complexity).toBe(1);
  });

  it("complexity of safeDiv is 2 (1 if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "safeDiv")?.complexity).toBe(2);
  });

  it("complexity of process is 4 (foreach + if + elseif)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.complexity).toBe(4);
  });

  it("add() call from process is captured", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call).toBeDefined();
  });

  it("call from a class method carries the caller's exact fromContainerType", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.fromContainerType).toBe("Calculator");
  });

  it("add() call resolves cross-file to helper.php", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.toFile).toBe("src/helper.php");
  });

  it("safeDiv() call resolves cross-file to helper.php", () => {
    const g = buildGraph();
    const call = g.calls.find(
      (c) => c.fromFunction === "process" && c.calleeName === "safeDiv"
    );
    expect(call?.toFile).toBe("src/helper.php");
  });
});
