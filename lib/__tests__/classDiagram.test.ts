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

  it("renders methods as +name() with default public visibility (v0.71)", () => {
    // v0.71: re-enabled method rendering after the v0.70 hold. Param/
    // return signatures are still missing — we render bare `+name()` —
    // because that gives readers an idea of the class surface without
    // pretending we know more than we do. Visibility defaults to `+`
    // since FunctionDef doesn't carry per-method modifier info yet.
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
    expect(source).toContain("+login()");
    expect(source).toContain("+complicatedFunction()");
  });

  it("does not render methods on enums (values list is the surface)", () => {
    // Enum entries have a values list instead of fields/methods —
    // adding `+name()` underneath would be visual noise.
    const cg = emptyGraph();
    cg.classes = [
      cls("Status", {
        isEnum: true,
        enumValues: ["Active", "Inactive"],
        methods: [method("describe", "src/foo.ts", "Status")],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Active");
    expect(source).not.toContain("+describe()");
  });

  it("does NOT render file-path notes (v0.71 — visual noise outweighed value)", () => {
    // Pre-v0.71 we appended `note for X "<full-path>"` under each class.
    // For 27-class diagrams the notes outweighed the class names and
    // fragmented the layout. File-path navigation lives in the Code
    // tab; the future ReactFlow canvas will surface it on hover/click.
    const cg = emptyGraph();
    cg.classes = [
      cls("User", { filePath: "src/auth/user.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("note for User");
    expect(source).not.toContain("src/auth/user.ts");
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

  it("does NOT mark readonly fields with any glyph (Mermaid has no native syntax)", () => {
    // v0.71: removed the `*` readonly prefix. Mermaid only treats `*` as
    // an abstract-method tag, never on fields, so it rendered as if the
    // glyph were part of the field name. Java's `private final X` and
    // TS's `readonly X` both still parse and capture isReadonly — we
    // just don't surface it visually until we adopt a stereotype line.
    const cg = emptyGraph();
    cg.classes = [
      cls("X", {
        fields: [field("id", "string", "public", { isReadonly: true })],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("+id string");
    expect(source).not.toContain("+*id");
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

  it("tags enums with <<enumeration>> and lists their values (v0.71)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Status", {
        isEnum: true,
        enumValues: ["Active", "Inactive", "Pending"],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("<<enumeration>>");
    expect(source).toContain("Active");
    expect(source).toContain("Inactive");
    expect(source).toContain("Pending");
    // Value entries don't get a visibility prefix — they're constants.
    expect(source).not.toContain("+Active");
    expect(source).not.toContain("-Active");
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

// ---------------- Namespace grouping (v0.71) ----------------

describe("generateClassDiagram · namespace grouping", () => {
  it("wraps classes in namespace blocks when there are multiple folders", () => {
    // Mermaid's classDiagram lays a flat graph horizontally — wrapping
    // by folder gives the renderer clusters to arrange, producing a
    // grid-like layout instead of one wide band.
    const cg = emptyGraph();
    cg.classes = [
      cls("LoginController", { filePath: "src/controller/LoginController.ts" }),
      cls("LogInService", { filePath: "src/service/LogInService.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("namespace controller {");
    expect(source).toContain("namespace service {");
    // Classes appear inside their respective namespace block
    const controllerIdx = source.indexOf("namespace controller {");
    const loginCtrlIdx = source.indexOf("class LoginController");
    const closeIdx = source.indexOf("}", controllerIdx);
    expect(loginCtrlIdx).toBeGreaterThan(controllerIdx);
    expect(loginCtrlIdx).toBeLessThan(closeIdx);
  });

  it("does NOT emit any file-path notes inside namespace mode (v0.71)", () => {
    // Pre-v0.71 namespaces hoisted notes after the closing braces.
    // v0.71 dropped notes entirely — the assertion is now the absence
    // of any `note for` line at all.
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { filePath: "src/a/A.ts" }),
      cls("B", { filePath: "src/b/B.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("note for");
  });

  it("falls back to flat layout when all classes are in one folder", () => {
    // Single-folder repos don't benefit from namespace wrapping —
    // the output stays flat (one fewer level of nesting in source).
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { filePath: "src/foo/A.ts" }),
      cls("B", { filePath: "src/foo/B.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("namespace");
  });

  it("uses full folder path when leaf names collide", () => {
    // Two distinct "service" folders (main + test) need different
    // namespace identifiers. Falls back to the full path so the two
    // groups don't collapse.
    const cg = emptyGraph();
    cg.classes = [
      cls("Real", { filePath: "src/main/service/Real.ts" }),
      cls("RealTest", { filePath: "src/test/service/RealTest.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    // At least one of the two namespaces should reflect the full path
    // (sanitized — slashes become underscores).
    expect(source).toMatch(/namespace src_main_service|namespace src_test_service/);
  });

  it("emits namespaces in alphabetical folder order (deterministic source)", () => {
    // Insertion-order-based output produces noisy git diffs when the
    // file index changes. Sort by folder so re-running yields the
    // same source.
    const cg = emptyGraph();
    cg.classes = [
      cls("Z", { filePath: "src/zzz/Z.ts" }),
      cls("A", { filePath: "src/aaa/A.ts" }),
      cls("M", { filePath: "src/mmm/M.ts" }),
    ];
    const { source } = generateClassDiagram(cg);
    const aaaIdx = source.indexOf("namespace aaa");
    const mmmIdx = source.indexOf("namespace mmm");
    const zzzIdx = source.indexOf("namespace zzz");
    expect(aaaIdx).toBeGreaterThan(0);
    expect(aaaIdx).toBeLessThan(mmmIdx);
    expect(mmmIdx).toBeLessThan(zzzIdx);
  });
});

// ---------------- Field-based association arrows (v0.71) ----------------

describe("generateClassDiagram · field-based associations", () => {
  it("emits Owner --> FieldType : fieldName when target is rendered", () => {
    // Spring DI's textbook pattern: a controller with a service field
    // gets an explicit dependency arrow to that service.
    const cg = emptyGraph();
    cg.classes = [
      cls("LoginController", {
        fields: [field("logInService", "LogInService", "private")],
      }),
      cls("LogInService"),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("LoginController --> LogInService : logInService");
  });

  it("does NOT emit an arrow when the field type isn't a rendered class", () => {
    // Stdlib types (List, Map, String) shouldn't pull orphan boxes
    // into the diagram. Skip when the target isn't already rendered.
    const cg = emptyGraph();
    cg.classes = [
      cls("Card", {
        fields: [
          field("cardTypes", "List", "private"),
          field("name", "String", "private"),
        ],
      }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("--> List");
    expect(source).not.toContain("--> String");
  });

  it("skips self-references (Foo with a Foo field)", () => {
    // Trees / linked lists have self-typed fields. Drawing a self-arrow
    // adds visual noise without revealing anything not already obvious
    // from the field list.
    const cg = emptyGraph();
    cg.classes = [
      cls("Node", { fields: [field("next", "Node", "public")] }),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).not.toContain("Node --> Node");
  });

  it("dedupes when one class has multiple fields of the same type", () => {
    // ValidationService having `vp: ValidatePassword` and `vp2: ValidatePassword`
    // gets ONE arrow, not two parallel ones (Mermaid would clip the labels).
    const cg = emptyGraph();
    cg.classes = [
      cls("Service", {
        fields: [
          field("primary", "Validator", "private"),
          field("backup", "Validator", "private"),
        ],
      }),
      cls("Validator"),
    ];
    const { source } = generateClassDiagram(cg);
    const arrowLines = source
      .split("\n")
      .filter((l) => l.includes("Service --> Validator"));
    expect(arrowLines.length).toBe(1);
  });

  it("skips arrows when target lies outside the active scope", () => {
    // Service in folder A has a field of type Helper in folder B. With
    // a folder=A scope, only Service renders — Helper isn't in scope,
    // so no arrow (we don't want orphan boxes leaking external types
    // into the filtered view).
    const cg = emptyGraph();
    cg.classes = [
      cls("Service", {
        filePath: "src/a/Service.ts",
        fields: [field("helper", "Helper", "private")],
      }),
      cls("Helper", { filePath: "src/b/Helper.ts" }),
    ];
    const { source } = generateClassDiagram(cg, {
      scope: { kind: "folder", folder: "src/a" },
    });
    expect(source).not.toContain("--> Helper");
  });

  it("peels generic wrappers (List<Card>, Map<K,V>) to find arrow target", () => {
    // The killer missing edge in TheDeckForge feedback: `private List<Card>
    // cards` in Collection should draw an arrow to Card. Direct match on
    // "List<Card>" obviously fails (List<Card> isn't a class), but
    // resolveArrowTarget peels off the generic to find the inner element.
    const cg = emptyGraph();
    cg.classes = [
      cls("Collection", {
        fields: [field("cards", "List<Card>", "private")],
      }),
      cls("Card"),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Collection --> Card : cards");
  });

  it("peels Go slice / pointer / map wrappers to find arrow target", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Service", {
        fields: [
          field("decks", "[]Deck", "public"),
          field("client", "*Client", "private"),
          field("byName", "map[string]User", "private"),
        ],
      }),
      cls("Deck"),
      cls("Client"),
      cls("User"),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Service --> Deck : decks");
    expect(source).toContain("Service --> Client : client");
    // Map: peel to value type (User), ignore key type (string).
    expect(source).toContain("Service --> User : byName");
  });

  it("peels nullable suffix (Foo?) to find arrow target", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Service", {
        fields: [field("validator", "Validator?", "private")],
      }),
      cls("Validator"),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("Service --> Validator : validator");
  });

  it("emits arrows for inheritance AND field associations on the same class", () => {
    // A repository class can both implement an interface AND depend on
    // an injected service. Both edges should render.
    const cg = emptyGraph();
    cg.classes = [
      cls("UserRepository", {
        implements: ["IUserRepository"],
        fields: [field("jdbcTemplate", "JdbcTemplate", "private")],
      }),
      cls("IUserRepository", { isInterface: true }),
      cls("JdbcTemplate"),
    ];
    const { source } = generateClassDiagram(cg);
    expect(source).toContain("IUserRepository <|.. UserRepository");
    expect(source).toContain(
      "UserRepository --> JdbcTemplate : jdbcTemplate"
    );
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
