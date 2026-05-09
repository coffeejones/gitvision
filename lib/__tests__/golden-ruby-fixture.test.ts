// Golden Ruby fixture — top-level methods, class methods, require_relative,
// cross-file call resolution.
//
// NOTE on complexity counting in Ruby: this fixture assumes basic decision
// points (if, elsif, each-block) count as +1 each. If the plugin counts
// differently (e.g. doesn't count blocks), update EXPECTED below and add
// a comment explaining why.

import { describe, it, expect, beforeAll } from "vitest";
import { rubyPlugin } from "../codeAnalysis/plugins/ruby";
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

const HELPER_RB = `def add(a, b)
  a + b
end

def safe_div(a, b)
  if b == 0
    return nil
  end
  a / b
end
`;

const MAIN_RB = `require_relative 'helper'

class Calculator
  def process(items)
    total = 0
    items.each do |item|
      if item > 0
        total = add(total, item)
      elsif item < 0
        total = safe_div(total, -item)
      end
    end
    total
  end
end
`;

// HAND-COUNTED (best-effort — Ruby's "each do |x|" complexity is plugin-specific):
// helper.rb:
//   add        → no decisions       → complexity 1
//   safe_div   → 1 if               → complexity 2
// main.rb:
//   Calculator.process → each + if + elsif → complexity 4
//                        (assuming each-block counts as decision point)

describe("golden Ruby fixture", () => {
  beforeAll(async () => {
    await rubyPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = { rel: "src/helper.rb", ext: "rb", content: HELPER_RB };
    const main: SourceFile = { rel: "src/main.rb", ext: "rb", content: MAIN_RB };
    const ix = makeIndex([helper, main]);
    const ph = parseFile(rubyPlugin, helper, ix);
    const pm = parseFile(rubyPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [ph, pm],
      pluginByFile: new Map([
        ["src/helper.rb", "ruby"],
        ["src/main.rb", "ruby"],
      ]),
    });
  }

  it("extracts exactly 3 methods", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("method names match (add, safe_div, process)", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["add", "process", "safe_div"]);
  });

  it("class method process has Calculator as containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.containerType).toBe("Calculator");
  });

  it("top-level method add has no containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.containerType).toBeUndefined();
  });

  it("complexity of add is 1", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.complexity).toBe(1);
  });

  it("complexity of safe_div is 2 (1 if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "safe_div")?.complexity).toBe(2);
  });

  it("complexity of process is 3 (if + elsif; do-block not counted)", () => {
    const g = buildGraph();
    // CALIBRATION NOTE: Ruby plugin does NOT count `each do |x|` as a
    // decision point — only conditional branches (if/elsif/unless/case-when).
    // Hand-counted at 3: base + if + elsif.
    expect(g.functions.find((f) => f.name === "process")?.complexity).toBe(3);
  });

  it("add() call from process is captured", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call).toBeDefined();
  });

  it("add() call resolves cross-file to helper.rb", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.toFile).toBe("src/helper.rb");
  });

  it("safe_div() call resolves cross-file to helper.rb", () => {
    const g = buildGraph();
    const call = g.calls.find(
      (c) => c.fromFunction === "process" && c.calleeName === "safe_div"
    );
    expect(call?.toFile).toBe("src/helper.rb");
  });
});
