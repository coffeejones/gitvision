// Tests for the cross-file aggregator. Pure logic — uses hand-built
// ParsedFile fixtures so we exercise the disambiguation rules and the
// per-plugin stats roll-up without hitting tree-sitter.

import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { ParsedFile } from "../codeAnalysis/types";

function pf(over: Partial<ParsedFile> & { rel: string }): ParsedFile {
  return {
    rel: over.rel,
    imports: over.imports ?? [],
    functions: over.functions ?? [],
    calls: over.calls ?? [],
    fileComplexity: over.fileComplexity ?? 1,
    parseError: over.parseError ?? false,
    ...(over.classes !== undefined ? { classes: over.classes } : {}),
    ...(over.routes !== undefined ? { routes: over.routes } : {}),
  };
}

describe("buildCodeGraph", () => {
  it("returns an empty graph for an empty input", () => {
    const g = buildCodeGraph({
      parsedFiles: [],
      pluginByFile: new Map(),
    });
    expect(g.functions).toEqual([]);
    expect(g.calls).toEqual([]);
    expect(g.imports).toEqual([]);
    expect(g.byPlugin).toEqual({});
    expect(g.fileComplexity).toEqual({});
  });

  it("collects functions across files with their owning file path", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [
          { name: "foo", startRow: 10, endRow: 20, complexity: 3 },
          { name: "bar", startRow: 25, endRow: 30, complexity: 1 },
        ],
      }),
      pf({
        rel: "src/b.ts",
        functions: [
          { name: "baz", startRow: 5, endRow: 15, complexity: 2 },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map([
        ["src/a.ts", "javascript"],
        ["src/b.ts", "javascript"],
      ]),
    });
    expect(g.functions).toHaveLength(3);
    expect(g.functions.find((f) => f.name === "foo")?.filePath).toBe(
      "src/a.ts"
    );
    expect(g.functions.find((f) => f.name === "baz")?.complexity).toBe(2);
  });

  it("resolves calls to the unique same-named function when there's only one", () => {
    const files = [
      pf({
        rel: "src/api.ts",
        functions: [{ name: "fetchUser", startRow: 1, endRow: 10, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        calls: [{ calleeName: "fetchUser", inFunction: "render" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.calleeName === "fetchUser");
    expect(edge?.toFile).toBe("src/api.ts");
    expect(edge?.toFunction).toBe("fetchUser");
    expect(edge?.fromFunction).toBe("render");
  });

  it("disambiguates same-named functions: prefers same-file definition", () => {
    const files = [
      pf({
        rel: "src/local.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
        calls: [{ calleeName: "helper", inFunction: "main" }],
      }),
      pf({
        rel: "src/other.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    expect(edge.toFile).toBe("src/local.ts");
  });

  it("disambiguates via imports when no same-file definition", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/b.ts",
        functions: [{ name: "helper", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        imports: [{ rawSpec: "./b", resolvedPath: "src/b.ts" }],
        calls: [{ calleeName: "helper", inFunction: null }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    // src/b.ts is imported by src/page.ts, src/a.ts isn't — so b wins
    expect(edge.toFile).toBe("src/b.ts");
  });

  it("leaves ambiguous calls unresolved (multiple candidates, no import hint)", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "shared", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/b.ts",
        functions: [{ name: "shared", startRow: 1, endRow: 5, complexity: 1 }],
      }),
      pf({
        rel: "src/page.ts",
        calls: [{ calleeName: "shared", inFunction: null }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    const edge = g.calls[0];
    expect(edge.toFile).toBeNull(); // ambiguous
    expect(edge.toFunction).toBeNull();
    expect(edge.calleeName).toBe("shared");
  });

  it("type-aware: matches calleeType against containerType before name fallback (v0.15)", () => {
    // The Java validator scenario: 7 ValidateXxx classes each with a
    // validate() method. Without type-aware resolution, a `vp.validate()`
    // call would pick whichever validator file was iterated first. With
    // calleeType + containerType the match is deterministic.
    const files = [
      pf({
        rel: "ValidatePassword.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 5,
            containerType: "ValidatePassword",
          },
        ],
      }),
      pf({
        rel: "ValidateEmail.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 4,
            containerType: "ValidateEmail",
          },
        ],
      }),
      pf({
        rel: "ValidateUserName.java",
        functions: [
          {
            name: "validate",
            startRow: 1,
            endRow: 10,
            complexity: 3,
            containerType: "ValidateUserName",
          },
        ],
      }),
      pf({
        rel: "Service.java",
        // Two calls to "validate" with DIFFERENT calleeTypes — both should
        // resolve correctly (no first-wins collapse).
        calls: [
          {
            calleeName: "validate",
            inFunction: "run",
            calleeType: "ValidateEmail",
          },
          {
            calleeName: "validate",
            inFunction: "run",
            calleeType: "ValidateUserName",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls).toHaveLength(2);
    const resolutions = g.calls.map((c) => c.toFile).sort();
    expect(resolutions).toEqual([
      "ValidateEmail.java",
      "ValidateUserName.java",
    ]);
  });

  it("type-aware: returns null when calleeType points to an external/unknown class (no fallthrough)", () => {
    // Found during v0.21 serilog validation. Pre-fix, pickCallTarget would
    // short-circuit on candidates.length === 1 BEFORE checking calleeType.
    // Result: production code calling `writer.Flush()` (writer is
    // System.IO.TextWriter) would resolve to a test file's NullTextWriter.Flush,
    // because that's the only Flush in our index. The fix: when calleeType
    // is set, only resolve to a containerType-matching candidate; otherwise
    // leave unresolved (the receiver is external — silently picking the
    // single internal candidate by name is wrong).
    const files = [
      pf({
        rel: "test/Helper.cs",
        functions: [
          {
            name: "Flush",
            startRow: 1,
            endRow: 5,
            complexity: 1,
            containerType: "TestHelper",
          },
        ],
      }),
      pf({
        rel: "src/Logger.cs",
        calls: [
          {
            calleeName: "Flush",
            inFunction: "Write",
            // Receiver type was inferred as TextWriter — an external class
            // we don't index. No internal class has containerType=TextWriter.
            calleeType: "TextWriter",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
    expect(g.calls[0].toFunction).toBeNull();
  });

  it("hasReceiver + no calleeType: refuses single-candidate match (dynamic-language safety)", () => {
    // Found during v0.23 rspec-core validation. Pre-fix, a Ruby `obj.method()`
    // call where obj's type was unknown would single-candidate-match
    // against any `def method` in the codebase — typically the only one was
    // in test fixtures (spec_helper.rb's `def new`, etc.), producing 76
    // bogus lib->spec edges. Post-fix: receiver-having calls without a
    // resolved calleeType skip single-candidate-match and require a
    // proximity (same-file/imported) win.
    const files = [
      pf({
        rel: "spec/spec_helper.rb",
        functions: [
          {
            name: "new",
            startRow: 1,
            endRow: 5,
            complexity: 1,
            containerType: "SpecHelper",
          },
        ],
      }),
      pf({
        rel: "lib/coordinator.rb",
        calls: [
          {
            calleeName: "new",
            inFunction: "bisect_with",
            // hasReceiver: true — call was `something.new` where the type
            // of "something" couldn't be inferred (dynamic Ruby).
            hasReceiver: true,
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
  });

  it("hasReceiver: false bare calls keep single-candidate match (don't lose real signal)", () => {
    // Counterpart to the previous test. Bare calls (`helper()` with no
    // receiver) are typically free-standing functions or self-method
    // shorthand; single-candidate-match is the right default for them.
    const files = [
      pf({
        rel: "src/helpers.ts",
        functions: [
          {
            name: "fetchUser",
            startRow: 1,
            endRow: 5,
            complexity: 1,
          },
        ],
      }),
      pf({
        rel: "src/page.ts",
        calls: [
          {
            calleeName: "fetchUser",
            inFunction: "render",
            // hasReceiver: false (or undefined) — bare call
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("src/helpers.ts");
  });

  it("hasReceiver: true with no calleeType still uses proximity heuristics", () => {
    // Receiver-having calls aren't ALWAYS unresolved — same-file or
    // imported-file matches still resolve them. Only the
    // single-candidate-by-name shortcut is disabled.
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [
          {
            name: "process",
            startRow: 1,
            endRow: 5,
            complexity: 1,
          },
        ],
      }),
      pf({
        rel: "src/unrelated.ts",
        functions: [
          {
            name: "process",
            startRow: 1,
            endRow: 5,
            complexity: 1,
          },
        ],
      }),
      pf({
        rel: "src/page.ts",
        imports: [{ rawSpec: "./a", resolvedPath: "src/a.ts" }],
        calls: [
          {
            calleeName: "process",
            inFunction: "render",
            hasReceiver: true,
            // calleeType undefined — but receiver was present
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    // Imported-file proximity wins over the unrelated same-named function
    expect(g.calls[0].toFile).toBe("src/a.ts");
  });

  it("type-aware: does NOT consult same-file or imported-file fallback when calleeType is set but unmatched", () => {
    // Strict-typing semantic: a typed receiver is a strong signal. Even if
    // a same-file or imported-file candidate exists, we don't pick it when
    // its containerType doesn't match — the receiver type is external
    // information that overrides proximity.
    const files = [
      pf({
        rel: "src/Caller.cs",
        functions: [
          // Same-file candidate that would normally win under proximity
          {
            name: "Save",
            startRow: 1,
            endRow: 5,
            complexity: 1,
            containerType: "Caller",
          },
        ],
        calls: [
          {
            calleeName: "Save",
            inFunction: "Run",
            // Receiver type is JpaRepository — not Caller. The same-file
            // Caller.Save shouldn't win.
            calleeType: "JpaRepository",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
  });

  it("type-aware match overrides same-file fallback when calleeType is set", () => {
    // Edge case: a same-file shadow plus an external typed candidate. The
    // typed match wins because it's a stronger signal than file proximity.
    const files = [
      pf({
        rel: "External.java",
        functions: [
          {
            name: "doIt",
            startRow: 1,
            endRow: 3,
            complexity: 1,
            containerType: "External",
          },
        ],
      }),
      pf({
        rel: "Local.java",
        functions: [
          {
            name: "doIt",
            startRow: 5,
            endRow: 7,
            complexity: 1,
            containerType: "Local",
          },
        ],
        calls: [
          {
            calleeName: "doIt",
            inFunction: "caller",
            calleeType: "External",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("External.java");
    expect(g.calls[0].toFunction).toBe("doIt");
  });

  it("populates toContainerType on resolved CallEdges (v0.28)", () => {
    // pickCallTarget returns a FunctionDef; codeGraph copies its
    // containerType onto the resulting CallEdge so blast-radius BFS
    // can distinguish same-named overloads in different classes.
    const files = [
      pf({
        rel: "Blueprint.py",
        functions: [
          {
            name: "__init__",
            startRow: 1,
            endRow: 5,
            complexity: 1,
            containerType: "Blueprint",
          },
        ],
      }),
      pf({
        rel: "Caller.py",
        calls: [
          {
            calleeName: "__init__",
            inFunction: "factory",
            calleeType: "Blueprint",
          },
        ],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("Blueprint.py");
    expect(g.calls[0].toFunction).toBe("__init__");
    expect(g.calls[0].toContainerType).toBe("Blueprint");
  });

  it("leaves toContainerType undefined when the resolved target has no container", () => {
    // Top-level / module-scope functions have no container. The CallEdge
    // reflects that: toContainerType stays undefined rather than ""
    // — so consumers can disambiguate "no container" from "container =
    // empty-string".
    const files = [
      pf({
        rel: "helpers.ts",
        functions: [
          {
            name: "fetchUser",
            startRow: 1,
            endRow: 3,
            complexity: 1,
            // no containerType — top-level function
          },
        ],
      }),
      pf({
        rel: "page.ts",
        calls: [{ calleeName: "fetchUser", inFunction: "render" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("helpers.ts");
    expect(g.calls[0].toContainerType).toBeUndefined();
  });

  it("leaves toContainerType undefined on unresolved CallEdges", () => {
    // No candidates → toFile is null, toFunction is null, toContainerType
    // also stays undefined. Defensive check for the chain.
    const files = [
      pf({
        rel: "page.ts",
        calls: [{ calleeName: "missing", inFunction: "render" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
    expect(g.calls[0].toContainerType).toBeUndefined();
  });

  it("emits import edges only for resolved targets and dedupes by (kind, from, to)", () => {
    const files = [
      pf({
        rel: "src/page.ts",
        imports: [
          { rawSpec: "react", resolvedPath: null },
          { rawSpec: "./util", resolvedPath: "src/util.ts" },
          { rawSpec: "./util.js", resolvedPath: "src/util.ts" }, // same target, dup
          { rawSpec: "./Btn", resolvedPath: "src/Btn.tsx", kind: "extends" },
        ],
      }),
      pf({ rel: "src/util.ts" }),
      pf({ rel: "src/Btn.tsx" }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.imports).toHaveLength(2); // util import + Btn extends; "react" excluded; dup collapsed
    expect(
      g.imports.find((e) => e.to === "src/Btn.tsx")?.kind
    ).toBe("extends");
    expect(g.imports.find((e) => e.to === "src/util.ts")?.kind).toBe("import");
  });

  it("collects byPlugin stats keyed by which plugin parsed each file", () => {
    const files = [
      pf({
        rel: "src/a.ts",
        functions: [{ name: "f", startRow: 1, endRow: 5, complexity: 1 }],
        calls: [{ calleeName: "g", inFunction: "f" }],
        imports: [{ rawSpec: "./b", resolvedPath: "src/b.ts" }],
      }),
      pf({
        rel: "Main.java",
        imports: [{ rawSpec: "../u", resolvedPath: "u.java", kind: "extends" }],
      }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map([
        ["src/a.ts", "javascript"],
        ["Main.java", "regex-fallback"],
      ]),
    });
    expect(g.byPlugin.javascript).toEqual({
      files: 1,
      functions: 1,
      calls: 1,
      imports: 1,
    });
    expect(g.byPlugin["regex-fallback"]).toEqual({
      files: 1,
      functions: 0,
      calls: 0,
      imports: 1,
    });
  });

  it("rolls fileComplexity per file and counts files-by-extension", () => {
    const files = [
      pf({ rel: "src/a.ts", fileComplexity: 12 }),
      pf({ rel: "src/b.ts", fileComplexity: 5 }),
      pf({ rel: "src/c.tsx", fileComplexity: 8 }),
      pf({ rel: "Main.java", fileComplexity: 1 }),
    ];
    const g = buildCodeGraph({
      parsedFiles: files,
      pluginByFile: new Map(),
    });
    expect(g.fileComplexity["src/a.ts"]).toBe(12);
    expect(g.filesByExt).toEqual({ ts: 2, tsx: 1, java: 1 });
  });

  it("propagates the truncated reason when supplied", () => {
    const g = buildCodeGraph({
      parsedFiles: [],
      pluginByFile: new Map(),
      truncated: "MAX_FILES capped",
    });
    expect(g.truncated).toBe("MAX_FILES capped");
  });

  // ---------------- Class aggregation (v0.70) ----------------

  it("aggregates per-file ParsedClass entries into cg.classes", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "src/user.ts",
          classes: [
            {
              name: "User",
              startRow: 0,
              endRow: 10,
              fields: [
                {
                  name: "id",
                  type: "string",
                  visibility: "public",
                  isStatic: false,
                },
              ],
              methodNames: [],
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.classes).toHaveLength(1);
    expect(g.classes![0]).toMatchObject({
      name: "User",
      filePath: "src/user.ts",
      fields: [{ name: "id", type: "string" }],
    });
  });

  it("disambiguates duplicate class names across files via filename suffix", () => {
    // Multiple Props interfaces (canonical React/TS pattern). Mermaid
    // would silently merge them into one entity if names weren't
    // disambiguated, producing FALSE diagrams. This test exists
    // specifically to prevent regression of the v0.70 polish.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "components/HeadlineFinding.tsx",
          classes: [
            {
              name: "Props",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
        pf({
          rel: "components/AiSummaryPanel.tsx",
          classes: [
            {
              name: "Props",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    const names = g.classes!.map((c) => c.name).sort();
    expect(names).toEqual([
      "Props_AiSummaryPanel",
      "Props_HeadlineFinding",
    ]);
  });

  it("appends a numeric suffix when basename-disambiguation still collides (v0.77)", () => {
    // Surfaced on Flask: `tests/test_views.py` and `examples/tutorial/test_views.py`
    // both define `class Index(MethodView)`. Pass-1 disambiguation produces
    // `Index_test_views` for BOTH, which collides as a React key in the
    // class canvas (ReactFlow drops the duplicate edge silently). Pass-2
    // appends `_2`, `_3`, … so each class is uniquely keyable.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "tests/test_views.py",
          classes: [
            {
              name: "Index",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
        pf({
          rel: "examples/tutorial/test_views.py",
          classes: [
            {
              name: "Index",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
        pf({
          rel: "examples/blog/test_views.py",
          classes: [
            {
              name: "Index",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    const names = g.classes!.map((c) => c.name);
    // All three names must be unique. First occurrence keeps the
    // bare basename-disambiguated form to stay backwards-compatible
    // with v0.70's existing test fixtures.
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe("Index_test_views");
    expect(names[1]).toBe("Index_test_views_2");
    expect(names[2]).toBe("Index_test_views_3");
  });

  it("leaves single-occurrence names unchanged", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "lib/types.ts",
          classes: [
            {
              name: "AnalysisSnapshot",
              startRow: 0,
              endRow: 5,
              fields: [],
              methodNames: [],
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.classes![0].name).toBe("AnalysisSnapshot");
  });

  it("returns undefined for cg.classes when no class extraction happened", () => {
    const g = buildCodeGraph({
      parsedFiles: [pf({ rel: "src/foo.ts" })],
      pluginByFile: new Map(),
    });
    expect(g.classes).toBeUndefined();
  });
});

describe("buildCodeGraph — production code never resolves into a test", () => {
  // A test-local helper with a common name used to become a magnet for every
  // builtin call of that name: `duplicates.test.ts` defines a nested `find()`,
  // so `Array.prototype.find` in production resolved to it. Found mechanically
  // by scripts/graph-precision.mjs. The rule is asymmetric on purpose — see the
  // guard in pickCallTarget.
  const helper = { name: "writeFile", startRow: 1, endRow: 5, complexity: 1 };

  it("leaves the call unresolved rather than pointing production at a test helper", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "lib/__tests__/workspaces.test.ts", functions: [helper] }),
        pf({
          rel: "lib/atomicWrite.ts",
          // This is Node's fs.writeFile, not any function in this repo.
          calls: [{ calleeName: "writeFile", inFunction: "atomicWriteJson" }],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile === "lib/atomicWrite.ts");
    expect(edge?.toFile).toBeNull();
    expect(edge?.toFunction).toBeNull();
  });

  it("STILL resolves test → production — computeTestCoverage depends on it", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "lib/atomicWrite.ts",
          functions: [{ name: "atomicWriteJson", startRow: 1, endRow: 9, complexity: 2 }],
        }),
        pf({
          rel: "lib/__tests__/atomicWrite.test.ts",
          calls: [{ calleeName: "atomicWriteJson", inFunction: "spec" }],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile.includes(".test."));
    expect(edge?.toFile).toBe("lib/atomicWrite.ts");
  });

  it("still resolves test → test (ordinary helper reuse inside a suite)", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "lib/__tests__/helpers.test.ts", functions: [helper] }),
        pf({
          rel: "lib/__tests__/other.test.ts",
          calls: [{ calleeName: "writeFile", inFunction: "spec" }],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile === "lib/__tests__/other.test.ts");
    expect(edge?.toFile).toBe("lib/__tests__/helpers.test.ts");
  });

  it("prefers the production definition when a test defines the same name", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "lib/__tests__/dup.test.ts", functions: [{ ...helper, name: "load" }] }),
        pf({
          rel: "lib/real.ts",
          functions: [{ name: "load", startRow: 1, endRow: 4, complexity: 1 }],
        }),
        pf({ rel: "lib/caller.ts", calls: [{ calleeName: "load", inFunction: "go" }] }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile === "lib/caller.ts");
    expect(edge?.toFile).toBe("lib/real.ts");
  });
});

describe("buildCodeGraph — constructor calls", () => {
  const ctorOf = (cls: string) => ({
    name: "constructor",
    startRow: 2,
    endRow: 6,
    complexity: 1,
    containerType: cls,
  });

  it("resolves `new Foo()` to Foo's constructor, not to a function named Foo", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "src/widget.ts", functions: [ctorOf("Widget")] }),
        pf({
          rel: "src/make.ts",
          imports: [{ rawSpec: "./widget", resolvedPath: "src/widget.ts" }],
          calls: [
            { calleeName: "Widget", inFunction: "make", calleeType: "Widget", isConstructor: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile === "src/make.ts");
    expect(edge?.toFile).toBe("src/widget.ts");
    expect(edge?.toFunction).toBe("constructor");
    expect(edge?.toContainerType).toBe("Widget");
  });

  it("refuses a same-named class the caller doesn't import — class names repeat", () => {
    // zod defines the same class in its v3 and v4 packages; matching on
    // containerType alone added 84 unjustified edges there.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "v3/error.ts", functions: [ctorOf("ZodError")] }),
        pf({ rel: "v4/error.ts", functions: [ctorOf("ZodError")] }),
        pf({
          rel: "v4/parse.ts",
          imports: [{ rawSpec: "./error", resolvedPath: "v4/error.ts" }],
          calls: [
            { calleeName: "ZodError", inFunction: "fail", calleeType: "ZodError", isConstructor: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.fromFile === "v4/parse.ts");
    expect(edge?.toFile).toBe("v4/error.ts");
  });

  it("leaves it unresolved when no candidate class is in scope", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "a/error.ts", functions: [ctorOf("Thing")] }),
        pf({ rel: "b/error.ts", functions: [ctorOf("Thing")] }),
        pf({
          rel: "c/use.ts", // imports neither
          calls: [
            { calleeName: "Thing", inFunction: "go", calleeType: "Thing", isConstructor: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls.find((c) => c.fromFile === "c/use.ts")?.toFile).toBeNull();
  });

  it("still handles ES5 constructor functions — `new Foo()` where Foo IS a function", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "src/legacy.js",
          functions: [{ name: "Widget", startRow: 1, endRow: 5, complexity: 1 }],
          calls: [
            { calleeName: "Widget", inFunction: "make", calleeType: "Widget", isConstructor: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    const edge = g.calls.find((c) => c.calleeName === "Widget");
    expect(edge?.toFile).toBe("src/legacy.js");
    expect(edge?.toFunction).toBe("Widget");
  });
});

// ---------------------------------------------------------------------------
// Routing tables → handler entry points.
//
// A table names its handler in another file, so only this layer can resolve it.
// The declining cases carry the weight: an entry point asserts that untrusted
// input reaches a function, and a wrong one invents reachability that the
// security layer would then use to justify suppressing real findings.
// ---------------------------------------------------------------------------
describe("buildCodeGraph — route declarations", () => {
  const fn = (name: string, filePath: string) => ({
    name,
    startRow: 0,
    endRow: 3,
    complexity: 1,
    filePath,
  });
  const view = (rel: string, ...names: string[]) =>
    pf({ rel, functions: names.map((n) => fn(n, rel)) });
  const entryOf = (g: ReturnType<typeof buildCodeGraph>, name: string) =>
    g.functions.find((f) => f.name === name)?.entryPoint;

  it("resolves a table row to a handler defined in another file", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "xss"),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/xss", targetModule: "views", targetName: "xss", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "xss")).toEqual({
      kind: "http-route",
      route: "/xss",
      via: "path()",
    });
  });

  it("uses the module qualifier to pick between same-named handlers", () => {
    // `from . import apis, views` then `apis.ping` must not land on views.ping.
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "ping"),
        view("app/apis.py", "ping"),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/api/ping", targetModule: "apis", targetName: "ping", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.functions.find((f) => f.filePath === "app/apis.py")?.entryPoint?.route).toBe(
      "/api/ping"
    );
    expect(g.functions.find((f) => f.filePath === "app/views.py")?.entryPoint).toBeUndefined();
  });

  it("falls back to the table's own directory when the module can't decide", () => {
    // Two Django apps, each with views.home. The table in app_a owns app_a's.
    const g = buildCodeGraph({
      parsedFiles: [
        view("app_a/views.py", "home"),
        view("app_b/views.py", "home"),
        pf({
          rel: "app_a/urls.py",
          routes: [
            { route: "/", targetModule: "views", targetName: "home", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.functions.find((f) => f.filePath === "app_a/views.py")?.entryPoint).toBeDefined();
    expect(g.functions.find((f) => f.filePath === "app_b/views.py")?.entryPoint).toBeUndefined();
  });

  it("stamps NOTHING when the target stays ambiguous", () => {
    // Same name, same module name, neither in the table's directory. Picking
    // one would invent reachability for whichever we guessed wrong.
    const g = buildCodeGraph({
      parsedFiles: [
        view("app_a/views.py", "home"),
        view("app_b/views.py", "home"),
        pf({
          rel: "config/urls.py",
          routes: [
            { route: "/", targetModule: "views", targetName: "home", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.functions.every((f) => f.entryPoint === undefined)).toBe(true);
  });

  it("resolves a bare target with no module qualifier", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "home"),
        pf({
          rel: "app/urls.py",
          routes: [{ route: "/", targetModule: null, targetName: "home", via: "path()" }],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "home")?.route).toBe("/");
  });

  it("ignores a row naming a handler that doesn't exist", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "home"),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/gone", targetModule: "views", targetName: "missing", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "home")).toBeUndefined();
  });

  it("lets a decorator on the handler win over a table pointing at it", () => {
    const decorated = pf({ rel: "app/views.py", functions: [fn("home", "app/views.py")] });
    decorated.functions[0].entryPoint = {
      kind: "http-route",
      methods: ["POST"],
      route: "/decorated",
      via: "@app.post",
    };
    const g = buildCodeGraph({
      parsedFiles: [
        decorated,
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/from-table", targetModule: "views", targetName: "home", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "home")?.route).toBe("/decorated");
  });

  it("keeps the smallest route when one handler is wired to several", () => {
    // pygoat wires sql_lab to both "sql_lab" and "sql_lab1". Whichever we keep
    // must not depend on file iteration order.
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "lab"),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/lab1", targetModule: "views", targetName: "lab", via: "path()" },
            { route: "/lab", targetModule: "views", targetName: "lab", via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "lab")?.route).toBe("/lab");
  });

  it("carries methods through when a table states them", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        view("app/views.py", "submit"),
        pf({
          rel: "app/urls.py",
          routes: [
            {
              route: "/submit",
              methods: ["POST"],
              targetModule: "views",
              targetName: "submit",
              via: "path()",
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "submit")?.methods).toEqual(["POST"]);
  });
});

// ---------------------------------------------------------------------------
// Module-qualified calls: `crud.get_user_by_email()` where crud is a FILE.
//
// The plugin reports calleeType="crud" because that is what precedes the dot,
// but no class carries that containerType, so the strict type match can never
// hit — and hasReceiver blocks the top-level fallthrough. Measured on
// full-stack-fastapi-template: 45 dropped edges, all of them route→crud and
// route→security, i.e. the spine.
//
// Verified inert on Java (spring-petclinic) and TypeScript (this repo): +0/-0
// edges, because those plugins don't report a bare module name as calleeType.
// ---------------------------------------------------------------------------
describe("buildCodeGraph — module-qualified calls", () => {
  const crud = pf({
    rel: "app/crud.py",
    functions: [{ name: "get_user", startRow: 1, endRow: 5, complexity: 1 }],
  });

  it("resolves module.fn() when the caller imports the module's package", () => {
    // `from app import crud` resolves to app/__init__.py, NOT app/crud.py — so
    // a plain "did you import this file" check fails and the sibling-directory
    // rule is what carries it.
    const g = buildCodeGraph({
      parsedFiles: [
        crud,
        pf({ rel: "app/__init__.py" }),
        pf({
          rel: "app/api/login.py",
          imports: [{ rawSpec: "app", resolvedPath: "app/__init__.py" }],
          calls: [
            { calleeName: "get_user", inFunction: "login", calleeType: "crud", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("app/crud.py");
  });

  it("resolves when the module file itself is imported", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        crud,
        pf({
          rel: "app/api/login.py",
          imports: [{ rawSpec: "app.crud", resolvedPath: "app/crud.py" }],
          calls: [
            { calleeName: "get_user", inFunction: "login", calleeType: "crud", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBe("app/crud.py");
  });

  it("refuses when the receiver name doesn't match the file", () => {
    // `helpers.get_user()` must not land in crud.py just because crud.py is the
    // only file defining get_user.
    const g = buildCodeGraph({
      parsedFiles: [
        crud,
        pf({
          rel: "app/api/login.py",
          imports: [{ rawSpec: "app.crud", resolvedPath: "app/crud.py" }],
          calls: [
            { calleeName: "get_user", inFunction: "login", calleeType: "helpers", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
  });

  it("refuses when the caller imports nothing near the module", () => {
    // Name-matching a file somewhere in the repo is not evidence on its own.
    const g = buildCodeGraph({
      parsedFiles: [
        crud,
        pf({
          rel: "other/place.py",
          calls: [
            { calleeName: "get_user", inFunction: "go", calleeType: "crud", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
  });

  it("refuses to reach a METHOD through a module name", () => {
    // A module call cannot land on a class method. Without this guard, an
    // ordinary `x.push()` can resolve into any file that happens to define a
    // same-named member.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/crud.py",
          functions: [
            { name: "get_user", startRow: 1, endRow: 5, complexity: 1, containerType: "Repo" },
          ],
        }),
        pf({
          rel: "app/api/login.py",
          imports: [{ rawSpec: "app.crud", resolvedPath: "app/crud.py" }],
          calls: [
            { calleeName: "get_user", inFunction: "login", calleeType: "crud", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls[0].toFile).toBeNull();
  });

  it("still prefers an exact containerType match over the module reading", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        crud,
        pf({
          rel: "app/models.py",
          functions: [
            { name: "get_user", startRow: 1, endRow: 5, complexity: 1, containerType: "crud" },
          ],
        }),
        pf({
          rel: "app/api/login.py",
          imports: [{ rawSpec: "app.crud", resolvedPath: "app/crud.py" }],
          calls: [
            { calleeName: "get_user", inFunction: "login", calleeType: "crud", hasReceiver: true },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    // A real class named `crud` wins — that is the strict, evidence-backed match.
    expect(g.calls[0].toFile).toBe("app/models.py");
  });
});

// ---------------------------------------------------------------------------
// Class-based views: the table names a CLASS, so the entry points are the
// methods the framework invokes on it — which nothing in the repo calls.
// ---------------------------------------------------------------------------
describe("buildCodeGraph — class-based view routes", () => {
  const method = (name: string, filePath: string, containerType: string) => ({
    name,
    startRow: 0,
    endRow: 3,
    complexity: 1,
    containerType,
    filePath,
  });
  const cls = (name: string, parentClass?: string) => ({
    name,
    startRow: 0,
    endRow: 10,
    fields: [],
    methodNames: [],
    ...(parentClass ? { parentClass } : {}),
  });
  const entryOf = (g: ReturnType<typeof buildCodeGraph>, name: string, file?: string) =>
    g.functions.find((f) => f.name === name && (!file || f.filePath === file))?.entryPoint;

  const asViewRow = {
    route: "notifications/",
    targetModule: "views",
    targetName: "NotificationsView",
    targetIsClass: true,
    via: "path()",
  };

  it("marks the HTTP-verb methods a registered view defines", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/views.py",
          classes: [cls("NotificationsView")],
          functions: [
            method("get", "app/views.py", "NotificationsView"),
            method("post", "app/views.py", "NotificationsView"),
            method("build_context", "app/views.py", "NotificationsView"),
          ],
        }),
        pf({ rel: "app/urls.py", routes: [asViewRow] }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "get")?.route).toBe("notifications/");
    expect(entryOf(g, "post")?.route).toBe("notifications/");
    // A helper the framework never calls is not an entry point. It stays
    // reachable only if something actually calls it.
    expect(entryOf(g, "build_context")).toBeUndefined();
  });

  it("climbs to a base class when the registered class is pure configuration", () => {
    // NetBox's shape: `class WirelessLANViewSet(NetBoxModelViewSet)` declares
    // only queryset/serializer_class. The handlers live on the base, which the
    // repo also defines — and that base really is externally invocable.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/api/views.py",
          classes: [cls("SiteViewSet", "BaseViewSet")],
        }),
        pf({
          rel: "app/api/base.py",
          classes: [cls("BaseViewSet")],
          functions: [
            method("list", "app/api/base.py", "BaseViewSet"),
            method("retrieve", "app/api/base.py", "BaseViewSet"),
          ],
        }),
        pf({
          rel: "app/api/urls.py",
          routes: [
            {
              route: "sites",
              targetModule: "views",
              targetName: "SiteViewSet",
              targetIsClass: true,
              via: "router.register()",
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "list")?.route).toBe("sites");
    expect(entryOf(g, "retrieve")?.route).toBe("sites");
  });

  it("follows a LATER base when the first one is a mixin", () => {
    // `class NetBoxModelViewSet(ETagMixin, ..., BaseViewSet)` — Python puts
    // mixins first, so anything following only the head base walks into the
    // mixin and never reaches the class that defines the handlers.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/views.py",
          classes: [
            {
              ...cls("SiteView"),
              parentClass: "LoginRequiredMixin",
              baseClasses: ["LoginRequiredMixin", "BaseView"],
            },
          ],
        }),
        pf({
          rel: "app/mixins.py",
          classes: [cls("LoginRequiredMixin")],
          functions: [method("check_perms", "app/mixins.py", "LoginRequiredMixin")],
        }),
        pf({
          rel: "app/base.py",
          classes: [cls("BaseView")],
          functions: [method("post", "app/base.py", "BaseView")],
        }),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/site", targetModule: "views", targetName: "SiteView", targetIsClass: true, via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "post", "app/base.py")?.route).toBe("/site");
    expect(entryOf(g, "check_perms")).toBeUndefined();
  });

  it("takes the nearest level's handlers, not a grandparent's override", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/views.py",
          classes: [cls("SiteView", "MidView")],
        }),
        pf({
          rel: "app/mid.py",
          classes: [cls("MidView", "RootView")],
          functions: [method("get", "app/mid.py", "MidView")],
        }),
        pf({
          rel: "app/root.py",
          classes: [cls("RootView")],
          functions: [method("get", "app/root.py", "RootView")],
        }),
        pf({
          rel: "app/urls.py",
          routes: [
            { route: "/site", targetModule: "views", targetName: "SiteView", targetIsClass: true, via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "get", "app/mid.py")?.route).toBe("/site");
    expect(entryOf(g, "get", "app/root.py")).toBeUndefined();
  });

  it("stops climbing when the base class isn't in the repo", () => {
    // DRF's ModelViewSet owns list/retrieve. There is nothing of ours to mark,
    // and inventing an entry point would be worse than the miss.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "app/api/views.py",
          classes: [cls("SiteViewSet", "ModelViewSet")],
          functions: [method("get_queryset", "app/api/views.py", "SiteViewSet")],
        }),
        pf({
          rel: "app/api/urls.py",
          routes: [
            {
              route: "sites",
              targetModule: "views",
              targetName: "SiteViewSet",
              targetIsClass: true,
              via: "router.register()",
            },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(entryOf(g, "get_queryset")).toBeUndefined();
  });

  it("declines when two classes share the registered name", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "a/views.py",
          classes: [cls("HomeView")],
          functions: [method("get", "a/views.py", "HomeView")],
        }),
        pf({
          rel: "b/views.py",
          classes: [cls("HomeView")],
          functions: [method("get", "b/views.py", "HomeView")],
        }),
        pf({
          rel: "config/urls.py",
          routes: [
            { route: "/", targetModule: "views", targetName: "HomeView", targetIsClass: true, via: "path()" },
          ],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.functions.every((f) => f.entryPoint === undefined)).toBe(true);
  });

  it("survives an inheritance cycle", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "app/views.py", classes: [cls("A", "B"), cls("B", "A")] }),
        pf({
          rel: "app/urls.py",
          routes: [{ route: "/", targetModule: "views", targetName: "A", targetIsClass: true, via: "path()" }],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.functions).toEqual([]);
  });
});

// Following a re-export. `import pkg` then `pkg.thing()` stops at the package
// root under every path-based rule, because the file that DEFINES `thing` is
// neither imported nor named after what the caller typed. Measured on Flask:
// 1207 of 1637 unresolved test calls named a function that exists in the graph
// and is reachable only this way.
describe("buildCodeGraph — re-exports", () => {
  const fn = (name: string) => ({
    name, startRow: 1, endRow: 3, complexity: 1,
  });

  it("resolves a call through a package that re-exports the name", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "src/pkg/helpers.py", functions: [fn("url_for")] }),
        pf({
          rel: "src/pkg/__init__.py",
          imports: [{ rawSpec: ".helpers", resolvedPath: "src/pkg/helpers.py", symbols: ["url_for"] }],
        }),
        pf({
          rel: "tests/test_pkg.py",
          imports: [{ rawSpec: "pkg", resolvedPath: "src/pkg/__init__.py" }],
          calls: [{ calleeName: "url_for", inFunction: "test_x", calleeType: "pkg", hasReceiver: true }],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls.find((c) => c.fromFile === "tests/test_pkg.py")?.toFile)
      .toBe("src/pkg/helpers.py");
  });

  it("does NOT resolve a name the package does not re-export", () => {
    const g = buildCodeGraph({
      parsedFiles: [
        pf({ rel: "src/pkg/private.py", functions: [fn("internal")] }),
        pf({
          rel: "src/pkg/__init__.py",
          imports: [{ rawSpec: ".helpers", resolvedPath: "src/pkg/helpers.py", symbols: ["url_for"] }],
        }),
        pf({
          rel: "tests/test_pkg.py",
          imports: [{ rawSpec: "pkg", resolvedPath: "src/pkg/__init__.py" }],
          calls: [{ calleeName: "internal", inFunction: "t", calleeType: "pkg", hasReceiver: true }],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls.find((c) => c.fromFile === "tests/test_pkg.py")?.toFile).toBeNull();
  });

  it("resolves a class instantiated without a `new` keyword", () => {
    // Python writes `flask.Blueprint(...)`, so isConstructor is never set and
    // `Blueprint` is a containerType rather than a function name.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "src/pkg/blueprints.py",
          functions: [{ name: "__init__", startRow: 2, endRow: 6, complexity: 1, containerType: "Blueprint" }],
        }),
        pf({
          rel: "src/pkg/__init__.py",
          imports: [{ rawSpec: ".blueprints", resolvedPath: "src/pkg/blueprints.py", symbols: ["Blueprint"] }],
        }),
        pf({
          rel: "tests/test_bp.py",
          imports: [{ rawSpec: "pkg", resolvedPath: "src/pkg/__init__.py" }],
          calls: [{ calleeName: "Blueprint", inFunction: "t", calleeType: "pkg", hasReceiver: true }],
        }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls.find((c) => c.fromFile === "tests/test_bp.py")?.toFile)
      .toBe("src/pkg/blueprints.py");
  });

  it("still demands import proof for a class matched only by name", () => {
    // The same rule the flagged-constructor path enforces: a global name match
    // added 104 edges to zod, 84 of them unjustifiable.
    const g = buildCodeGraph({
      parsedFiles: [
        pf({
          rel: "far/away.py",
          functions: [{ name: "__init__", startRow: 2, endRow: 6, complexity: 1, containerType: "Thing" }],
        }),
        pf({ rel: "other/use.py", calls: [{ calleeName: "Thing", inFunction: "go", calleeType: "mod", hasReceiver: true }] }),
      ],
      pluginByFile: new Map(),
    });
    expect(g.calls.find((c) => c.fromFile === "other/use.py")?.toFile).toBeNull();
  });
});
