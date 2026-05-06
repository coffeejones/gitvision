// Tests for the Mermaid class-diagram generator (v0.70 / Phase 1).
//
// Hand-built CodeGraph fixtures so we can verify each rendering
// concern in isolation: visibility prefixes, stereotype tags,
// inheritance arrows, scope filtering, cap behavior, and the
// special-character escapes Mermaid is finicky about.

import { describe, it, expect } from "vitest";
import {
  computeScopeOptions,
  generateClassDiagram,
} from "../intelligence/classDiagram";
import type {
  ClassDef,
  CodeGraph,
  FunctionDef,
  ParsedField,
} from "../codeAnalysis/types";

// ---------------- Fixture builders ----------------

function emptyGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-05-07T00:00:00Z",
  };
}

function field(
  name: string,
  type: string | undefined,
  visibility: ParsedField["visibility"] = "public",
  extras: Partial<ParsedField> = {}
): ParsedField {
  return {
    name,
    type,
    visibility,
    isStatic: false,
    ...extras,
  };
}

function method(
  name: string,
  filePath = "src/foo.ts",
  containerType?: string
): FunctionDef {
  return {
    filePath,
    name,
    startRow: 1,
    endRow: 5,
    complexity: 1,
    containerType,
  };
}

function cls(
  name: string,
  overrides: Partial<ClassDef> = {}
): ClassDef {
  return {
    name,
    filePath: "src/foo.ts",
    startRow: 1,
    endRow: 30,
    fields: [],
    methods: [],
    ...overrides,
  };
}

// ---------------- Empty / degenerate ----------------

describe("generateClassDiagram · degenerate cases", () => {
  it("returns empty-state source on a graph with no classes", () => {
    const cg = emptyGraph();
    const result = generateClassDiagram(cg);
    expect(result.classCount).toBe(0);
    expect(result.totalAvailable).toBe(0);
    expect(result.source).toContain("classDiagram");
    expect(result.source).toContain("No classes found");
  });

  it("respects a scope filter that matches no classes", () => {
    const cg = emptyGraph();
    cg.classes = [cls("User", { filePath: "src/auth.ts" })];
    const result = generateClassDiagram(cg, {
      scope: { kind: "file", filePath: "src/missing.ts" },
    });
    expect(result.classCount).toBe(0);
    expect(result.truncated).toMatch(/Scope filter matched no/);
  });
});

// ---------------- Class block rendering ----------------

describe("generateClassDiagram · class block", () => {
  it("renders a basic class with fields", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("User", {
        fields: [
          field("name", "string"),
          field("age", "number"),
        ],
        methods: [
          method("login", "src/foo.ts", "User"),
          method("logout", "src/foo.ts", "User"),
        ],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("class User {");
    expect(source).toContain("+name string");
    expect(source).toContain("+age number");
  });

  it("does NOT render methods (v0.70 polish — empty parens are misleading)", () => {
    // Methods get hidden in v0.70 because we have method names but
    // not param/return signatures. Re-introduced when we extract
    // those in a future phase. See classDiagram.ts renderClassBlock.
    const cg = emptyGraph();
    cg.classes = [
      cls("User", {
        methods: [
          method("login", "src/foo.ts", "User"),
          method("complicatedFunction", "src/foo.ts", "User"),
        ],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("+login()");
    expect(source).not.toContain("+complicatedFunction()");
  });

  it("renders a file-path note below each class", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("User", { filePath: "src/auth/user.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain('note for User "src/auth/user.ts"');
  });

  it("uses correct visibility prefixes", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("X", {
        fields: [
          field("pub", "string", "public"),
          field("priv", "string", "private"),
          field("prot", "string", "protected"),
          field("intern", "string", "internal"),
        ],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("+pub string");
    expect(source).toContain("-priv string");
    expect(source).toContain("#prot string");
    expect(source).toContain("~intern string");
  });

  it("marks static fields with $ prefix", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("X", {
        fields: [field("VERSION", "string", "public", { isStatic: true })],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("+$VERSION string");
  });

  it("marks readonly fields with * prefix", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("X", {
        fields: [field("id", "string", "public", { isReadonly: true })],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("+*id string");
  });

  it("omits the type when undefined", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("X", { fields: [field("dynamicField", undefined, "public")] }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("+dynamicField");
    expect(source).not.toContain("+dynamicField undefined");
  });
});

// ---------------- Stereotypes ----------------

describe("generateClassDiagram · stereotypes", () => {
  it("tags interfaces with <<interface>>", () => {
    const cg = emptyGraph();
    cg.classes = [cls("Comparable", { isInterface: true })];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("<<interface>>");
  });

  it("tags abstract classes with <<abstract>>", () => {
    const cg = emptyGraph();
    cg.classes = [cls("Animal", { isAbstract: true })];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("<<abstract>>");
  });

  it("interface stereotype takes precedence over abstract", () => {
    // Shouldn't happen in real data, but be defensive.
    const cg = emptyGraph();
    cg.classes = [
      cls("Weird", { isInterface: true, isAbstract: true }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("<<interface>>");
    expect(source).not.toContain("<<abstract>>");
  });
});

// ---------------- Inheritance arrows ----------------

describe("generateClassDiagram · inheritance", () => {
  it("emits extends arrow (Parent <|-- Child)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Animal"),
      cls("Dog", { parentClass: "Animal" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Animal <|-- Dog");
  });

  it("emits implements arrow (Iface <|.. Class)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Comparable", { isInterface: true }),
      cls("Number", { implements: ["Comparable"] }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Comparable <|.. Number");
  });

  it("supports multiple implements on one class", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { isInterface: true }),
      cls("B", { isInterface: true }),
      cls("C", { implements: ["A", "B"] }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("A <|.. C");
    expect(source).toContain("B <|.. C");
  });

  it("flags external-reference inheritance in truncated", () => {
    const cg = emptyGraph();
    cg.classes = [cls("Dog", { parentClass: "Animal" })];
    const result = generateClassDiagram(cg);
    expect(result.truncated).toMatch(/outside the current scope/);
  });
});

// ---------------- Scope filtering ----------------

describe("generateClassDiagram · scope", () => {
  it("filters by file when scope.kind = 'file'", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("InAuth", { filePath: "src/auth.ts" }),
      cls("InApi", { filePath: "src/api.ts" }),
    ];
    const result = generateClassDiagram(cg, {
      scope: { kind: "file", filePath: "src/auth.ts" },
    });
    expect(result.classCount).toBe(1);
    expect(result.source).toContain("InAuth");
    expect(result.source).not.toContain("InApi");
  });

  it("filters by folder prefix when scope.kind = 'folder'", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Inside", { filePath: "src/auth/session.ts" }),
      cls("AlsoInside", { filePath: "src/auth/index.ts" }),
      cls("Outside", { filePath: "src/api/route.ts" }),
    ];
    const result = generateClassDiagram(cg, {
      scope: { kind: "folder", folder: "src/auth" },
    });
    expect(result.classCount).toBe(2);
    expect(result.source).toContain("Inside");
    expect(result.source).toContain("AlsoInside");
    expect(result.source).not.toContain("Outside");
  });
});

// ---------------- Caps ----------------

describe("generateClassDiagram · caps", () => {
  it("respects maxClasses option", () => {
    const cg = emptyGraph();
    cg.classes = Array.from({ length: 100 }, (_, i) => cls(`C${i}`));
    const result = generateClassDiagram(cg, { maxClasses: 5 });
    expect(result.classCount).toBe(5);
    expect(result.totalAvailable).toBe(100);
    expect(result.truncated).toMatch(/Capped at 5 classes/);
  });

  it("default cap is high enough to render typical alpha-tier repos", () => {
    // Real-world data point: GitVision itself surfaces 173 classes.
    // Default cap must comfortably exceed that or we silently lie
    // about the architecture.
    const cg = emptyGraph();
    cg.classes = Array.from({ length: 200 }, (_, i) => cls(`C${i}`));
    const result = generateClassDiagram(cg);
    expect(result.classCount).toBe(200);
    expect(result.truncated).toBeUndefined();
  });
});

// ---------------- Special-char handling ----------------

describe("generateClassDiagram · special characters", () => {
  it("escapes angle brackets in field types so Mermaid still parses", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Cache", {
        fields: [field("entries", "Map<string, User>")],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    // Tildes substitute for <> so the line doesn't break Mermaid's
    // arrow / stereotype syntax. Specific char doesn't matter, just
    // that raw < and > don't survive in field-type positions.
    expect(source).toContain("entries");
    const fieldLines = source.split("\n").filter((l) => l.includes("entries"));
    for (const line of fieldLines) {
      // Only check the field line itself — `<<interface>>` style
      // markers can legitimately contain angle brackets.
      expect(line).not.toMatch(/Map<string/);
    }
  });

  it("sanitises class names with dots / generics", () => {
    const cg = emptyGraph();
    cg.classes = [cls("Foo.Bar")];
    const { source } = generateClassDiagram(cg);
    // Output uses the sanitized identifier so Mermaid doesn't
    // interpret the dot as a member access.
    expect(source).toContain("Foo_Bar");
  });
});

// ---------------- Result shape ----------------

describe("generateClassDiagram · result shape", () => {
  it("starts every output with the classDiagram directive", () => {
    const cg = emptyGraph();
    cg.classes = [cls("A")];
    const { source } = generateClassDiagram(cg);
    expect(source.split("\n")[0]).toBe("classDiagram");
  });

  it("reports totalAvailable independent of maxClasses cap", () => {
    const cg = emptyGraph();
    cg.classes = Array.from({ length: 80 }, (_, i) => cls(`C${i}`));
    const result = generateClassDiagram(cg, { maxClasses: 10 });
    expect(result.totalAvailable).toBe(80);
    expect(result.classCount).toBe(10);
  });
});

// ---------------- computeScopeOptions ----------------

describe("computeScopeOptions", () => {
  it("returns empty for a graph without classes", () => {
    expect(computeScopeOptions(emptyGraph())).toEqual([]);
  });

  it("counts classes per folder, including all parent folders", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { filePath: "lib/auth/session.ts" }),
      cls("B", { filePath: "lib/auth/session.ts" }),
      cls("C", { filePath: "lib/codeAnalysis/blastRadius.ts" }),
    ];
    const options = computeScopeOptions(cg);
    const byFolder = Object.fromEntries(
      options.map((o) => [o.folder, o.classCount])
    );
    expect(byFolder["lib"]).toBe(3);
    expect(byFolder["lib/auth"]).toBe(2);
    expect(byFolder["lib/codeAnalysis"]).toBe(1);
  });

  it("sorts options by class count descending then folder name", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { filePath: "small/foo.ts" }),
      cls("B", { filePath: "big/a.ts" }),
      cls("C", { filePath: "big/b.ts" }),
      cls("D", { filePath: "big/c.ts" }),
    ];
    const options = computeScopeOptions(cg);
    expect(options[0].folder).toBe("big");
    expect(options[0].classCount).toBe(3);
  });

  it("respects the limit option", () => {
    const cg = emptyGraph();
    cg.classes = Array.from({ length: 50 }, (_, i) =>
      cls(`C${i}`, { filePath: `folder${i}/file.ts` })
    );
    const options = computeScopeOptions(cg, 5);
    expect(options).toHaveLength(5);
  });

  it("does not include the empty-string root folder", () => {
    const cg = emptyGraph();
    cg.classes = [cls("A", { filePath: "lib/foo.ts" })];
    const options = computeScopeOptions(cg);
    expect(options.every((o) => o.folder !== "")).toBe(true);
  });
});
