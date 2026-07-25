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
