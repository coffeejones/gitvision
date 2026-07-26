// CallEdge.fromContainerType — the CALLER's class, in every language.
//
// Without it the graph identifies a caller by name alone, so two sibling
// methods with the same name in one file collapse into a single node and the
// function-level blast radius answers for the wrong one. It shipped for JS/TS
// first and was later added to the rest, but nothing ever asserted it across
// languages — which is precisely why an audit of this codebase concluded it was
// still JS/TS-only. It wasn't; there was simply no way to tell.
//
// This is that way to tell. One parse per plugin, one question: when a class
// method calls something, does the edge remember which class it came from?

import { describe, it, expect, beforeAll } from "vitest";
import { ensureRuntime } from "../codeAnalysis/runtime";
import { parseFile } from "../codeAnalysis/parse";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { pythonPlugin } from "../codeAnalysis/plugins/python";
import { javaPlugin } from "../codeAnalysis/plugins/java";
import { csharpPlugin } from "../codeAnalysis/plugins/csharp";
import { phpPlugin } from "../codeAnalysis/plugins/php";
import { rubyPlugin } from "../codeAnalysis/plugins/ruby";
import { goPlugin } from "../codeAnalysis/plugins/go";
import type {
  CodeAnalysisPlugin,
  FileIndex,
  SourceFile,
} from "../codeAnalysis/types";

const index = (f: SourceFile): FileIndex => ({
  byPath: new Map([[f.rel, f]]),
  byExt: new Map([[f.ext, [f]]]),
  extras: new Map(),
});

/** Each case: one class named Alpha whose `run` calls its own `helper`. Written
 *  in each language's ordinary idiom — Ruby deliberately uses parentheses, see
 *  the note on the Ruby case below. */
const CASES: Array<{
  lang: string;
  plugin: CodeAnalysisPlugin;
  ext: string;
  src: string;
  caller: string;
}> = [
  {
    lang: "javascript",
    plugin: javascriptPlugin,
    ext: "ts",
    caller: "run",
    src: `class Alpha {\n  run() { this.helper(); }\n  helper() {}\n}\n`,
  },
  {
    lang: "python",
    plugin: pythonPlugin,
    ext: "py",
    caller: "run",
    src: `class Alpha:\n    def run(self):\n        self.helper()\n    def helper(self):\n        pass\n`,
  },
  {
    lang: "java",
    plugin: javaPlugin,
    ext: "java",
    caller: "run",
    src: `class Alpha {\n  void run() { helper(); }\n  void helper() {}\n}\n`,
  },
  {
    lang: "csharp",
    plugin: csharpPlugin,
    ext: "cs",
    caller: "Run",
    src: `class Alpha {\n  void Run() { Helper(); }\n  void Helper() {}\n}\n`,
  },
  {
    lang: "php",
    plugin: phpPlugin,
    ext: "php",
    caller: "run",
    src: `<?php\nclass Alpha {\n  function run() { $this->helper(); }\n  function helper() {}\n}\n`,
  },
  {
    // Parentheses on purpose. tree-sitter-ruby parses a bare `helper` with no
    // receiver, parentheses or arguments as an `identifier`, not a call, so the
    // plugin never sees it — a real recall gap in Ruby's most common idiom,
    // tracked separately. Every other Ruby call form works, and this asserts
    // the container is stamped on the ones we do capture.
    lang: "ruby",
    plugin: rubyPlugin,
    ext: "rb",
    caller: "run",
    src: `class Alpha\n  def run\n    helper()\n  end\n  def helper\n  end\nend\n`,
  },
  {
    // Go has receivers rather than classes; the receiver type is the container.
    lang: "go",
    plugin: goPlugin,
    ext: "go",
    caller: "Run",
    src: `package p\ntype Alpha struct{}\nfunc (a *Alpha) Run() { a.Helper() }\nfunc (a *Alpha) Helper() {}\n`,
  },
];

describe("CallEdge.fromContainerType — every plugin remembers the calling class", () => {
  beforeAll(async () => {
    await ensureRuntime();
    await Promise.all(CASES.map((c) => c.plugin.load()));
  }, 60_000);

  for (const { lang, plugin, ext, src, caller } of CASES) {
    it(`${lang}: a method call inside Alpha is stamped with Alpha`, () => {
      const file: SourceFile = { rel: `x.${ext}`, ext, content: src };
      const calls = parseFile(plugin, file, index(file)).calls.filter(
        (c) => c.inFunction === caller
      );
      expect(calls.length, `${lang} captured no call inside ${caller}`).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.fromContainerType, `${lang} left the caller's class unstamped`).toBe("Alpha");
      }
    });
  }

  it("leaves the container unset for a top-level function, in every language", () => {
    // The absence is as load-bearing as the presence: a module-scope caller has
    // no container, and inventing one would collapse it with a same-named method.
    const topLevel: Array<[string, CodeAnalysisPlugin, string, string, string]> = [
      ["javascript", javascriptPlugin, "ts", "function run() { helper(); }\nfunction helper() {}\n", "run"],
      ["python", pythonPlugin, "py", "def run():\n    helper()\ndef helper():\n    pass\n", "run"],
      ["go", goPlugin, "go", "package p\nfunc Run() { Helper() }\nfunc Helper() {}\n", "Run"],
    ];
    for (const [lang, plugin, ext, src, caller] of topLevel) {
      const file: SourceFile = { rel: `t.${ext}`, ext, content: src };
      const calls = parseFile(plugin, file, index(file)).calls.filter(
        (c) => c.inFunction === caller
      );
      expect(calls.length, `${lang} captured no top-level call`).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.fromContainerType, `${lang} invented a container`).toBeUndefined();
      }
    }
  });
});
