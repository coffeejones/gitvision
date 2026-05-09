// Golden Java fixture — static methods, class methods, cross-class
// call resolution, nested if/else complexity.

import { describe, it, expect, beforeAll } from "vitest";
import { javaPlugin } from "../codeAnalysis/plugins/java";
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

const HELPER_JAVA = `package com.example;

public class Helper {
    public static int add(int a, int b) {
        return a + b;
    }

    public static Integer safeDiv(int a, int b) {
        if (b == 0) {
            return null;
        }
        return a / b;
    }
}
`;

const MAIN_JAVA = `package com.example;

public class Main {
    public int process(int[] items) {
        int total = 0;
        for (int item : items) {
            if (item > 0) {
                total = Helper.add(total, item);
            } else if (item < 0) {
                Integer result = Helper.safeDiv(total, -item);
                if (result != null) {
                    total = result;
                }
            }
        }
        return total;
    }
}
`;

// HAND-COUNTED:
// Helper.java:
//   add       → no decisions    → complexity 1
//   safeDiv   → 1 if            → complexity 2
// Main.java:
//   process   → for + if + else-if + nested if   → complexity 5
// Cross-class: process calls Helper.add AND Helper.safeDiv

describe("golden Java fixture", () => {
  beforeAll(async () => {
    await javaPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = {
      rel: "src/com/example/Helper.java",
      ext: "java",
      content: HELPER_JAVA,
    };
    const main: SourceFile = {
      rel: "src/com/example/Main.java",
      ext: "java",
      content: MAIN_JAVA,
    };
    const ix = makeIndex([helper, main]);
    const ph = parseFile(javaPlugin, helper, ix);
    const pm = parseFile(javaPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [ph, pm],
      pluginByFile: new Map([
        ["src/com/example/Helper.java", "java"],
        ["src/com/example/Main.java", "java"],
      ]),
    });
  }

  it("extracts exactly 3 methods (add, safeDiv, process)", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("method names match exactly", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["add", "process", "safeDiv"]);
  });

  it("static method add has Helper as containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.containerType).toBe("Helper");
  });

  it("instance method process has Main as containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.containerType).toBe("Main");
  });

  it("complexity of add is 1", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.complexity).toBe(1);
  });

  it("complexity of safeDiv is 2 (1 if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "safeDiv")?.complexity).toBe(2);
  });

  it("complexity of process is 5 (for + if + else-if + nested if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.complexity).toBe(5);
  });

  it("Helper.add() call from process is captured", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call, "Helper.add() not captured — plugin may not handle ClassName.method() syntax").toBeDefined();
  });

  it("Helper.add() resolves cross-class to Helper.java", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.toFile).toBe("src/com/example/Helper.java");
  });

  it("Helper.safeDiv() resolves cross-class to Helper.java", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "safeDiv");
    expect(call?.toFile).toBe("src/com/example/Helper.java");
  });
});
