// Tests for the class-canvas data transformation (v0.72).
//
// Focus: data shape correctness — pure ClassDef[] → { nodes, edges }
// transformation. Layout positions are Dagre-computed, so we don't
// assert exact (x, y) values (Dagre's algorithm output isn't
// stability-guaranteed across versions); we assert SHAPE and
// EDGE-PRESENCE invariants instead.
//
// Render-side tests live in component files when needed. The
// transformation is the load-bearing logic for correctness — DOM
// rendering is just style.

import { describe, it, expect } from "vitest";
import { buildClassCanvas, layoutDagre } from "../intelligence/classCanvas";
import type {
  ClassDef,
  CodeGraph,
  FunctionDef,
  ParsedField,
} from "../codeAnalysis/types";

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
  return { name, type, visibility, isStatic: false, ...extras };
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

function cls(name: string, overrides: Partial<ClassDef> = {}): ClassDef {
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

describe("buildClassCanvas · degenerate cases", () => {
  it("returns empty arrays when there are no classes", () => {
    const result = buildClassCanvas(emptyGraph());
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.classCount).toBe(0);
    expect(result.totalAvailable).toBe(0);
  });

  it("returns empty arrays when scope filter matches nothing", () => {
    const cg = emptyGraph();
    cg.classes = [cls("A", { filePath: "src/a.ts" })];
    const result = buildClassCanvas(cg, {
      scope: { kind: "file", filePath: "src/missing.ts" },
    });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.totalAvailable).toBe(1);
  });
});

describe("buildClassCanvas · node shape", () => {
  it("creates one ReactFlow node per ClassDef with id = class name", () => {
    const cg = emptyGraph();
    cg.classes = [cls("User"), cls("Service")];
    const { nodes } = buildClassCanvas(cg);
    expect(nodes.map((n) => n.id).sort()).toEqual(["Service", "User"]);
  });

  it("populates node.data with label, fields, methodNames, file path", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("User", {
        filePath: "src/auth/User.ts",
        fields: [field("name", "string", "public")],
        methods: [method("login", "src/auth/User.ts", "User")],
      }),
    ];
    const { nodes } = buildClassCanvas(cg);
    expect(nodes[0].data.label).toBe("User");
    expect(nodes[0].data.filePath).toBe("src/auth/User.ts");
    expect(nodes[0].data.fields).toHaveLength(1);
    expect(nodes[0].data.fields[0].name).toBe("name");
    expect(nodes[0].data.methodNames).toEqual(["login"]);
  });

  it("propagates stereotype flags (interface, abstract, enum)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("IRepository", { isInterface: true }),
      cls("Shape", { isAbstract: true }),
      cls("Status", {
        isEnum: true,
        enumValues: ["Active", "Inactive"],
      }),
    ];
    const { nodes } = buildClassCanvas(cg);
    const byId = new Map(nodes.map((n) => [n.id, n.data]));
    expect(byId.get("IRepository")?.isInterface).toBe(true);
    expect(byId.get("Shape")?.isAbstract).toBe(true);
    expect(byId.get("Status")?.isEnum).toBe(true);
    expect(byId.get("Status")?.enumValues).toEqual(["Active", "Inactive"]);
  });

  it("assigns Dagre-computed positions (top-left from node center)", () => {
    // We don't assert exact coordinates (Dagre output varies across
    // versions), but each node should have FINITE x/y values so
    // ReactFlow can render them without NaN propagation.
    const cg = emptyGraph();
    cg.classes = [cls("A"), cls("B", { parentClass: "A" })];
    const { nodes } = buildClassCanvas(cg);
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it("places child nodes BELOW their parent (top-to-bottom layout)", () => {
    // The whole point of TB rankdir — extends arrows go down.
    const cg = emptyGraph();
    cg.classes = [cls("Animal"), cls("Dog", { parentClass: "Animal" })];
    const { nodes } = buildClassCanvas(cg);
    const animal = nodes.find((n) => n.id === "Animal")!;
    const dog = nodes.find((n) => n.id === "Dog")!;
    expect(dog.position.y).toBeGreaterThan(animal.position.y);
  });
});

describe("buildClassCanvas · edges", () => {
  it("emits an extends edge with kind=extends", () => {
    const cg = emptyGraph();
    cg.classes = [cls("Animal"), cls("Dog", { parentClass: "Animal" })];
    const { edges } = buildClassCanvas(cg);
    const extendsEdges = edges.filter((e) => e.data.kind === "extends");
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0].source).toBe("Animal");
    expect(extendsEdges[0].target).toBe("Dog");
  });

  it("emits implements edges with kind=implements", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("IRepo", { isInterface: true }),
      cls("UserRepo", { implements: ["IRepo"] }),
    ];
    const { edges } = buildClassCanvas(cg);
    const impl = edges.filter((e) => e.data.kind === "implements");
    expect(impl).toHaveLength(1);
    expect(impl[0].source).toBe("IRepo");
    expect(impl[0].target).toBe("UserRepo");
  });

  it("emits a field-based association edge with the field name as label data", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("LoginController", {
        fields: [field("logInService", "LogInService", "private")],
      }),
      cls("LogInService"),
    ];
    const { edges } = buildClassCanvas(cg);
    const assoc = edges.filter((e) => e.data.kind === "association");
    expect(assoc).toHaveLength(1);
    expect(assoc[0].source).toBe("LoginController");
    expect(assoc[0].target).toBe("LogInService");
    expect(assoc[0].data.fieldName).toBe("logInService");
  });

  it("peels generic wrappers when matching field types (List<Card> → Card)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Collection", {
        fields: [field("cards", "List<Card>", "private")],
      }),
      cls("Card"),
    ];
    const { edges } = buildClassCanvas(cg);
    const assoc = edges.find((e) => e.data.kind === "association");
    expect(assoc?.target).toBe("Card");
  });

  it("dedupes association edges (same owner+target counted once)", () => {
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
    const { edges } = buildClassCanvas(cg);
    const validatorEdges = edges.filter((e) => e.target === "Validator");
    expect(validatorEdges).toHaveLength(1);
  });

  it("skips association edges when target isn't rendered (avoids orphan boxes)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Card", {
        fields: [field("name", "String", "private")],
      }),
    ];
    const { edges } = buildClassCanvas(cg);
    expect(edges.filter((e) => e.data.kind === "association")).toHaveLength(0);
  });

  it("skips self-reference associations (Foo with Foo field)", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Node", { fields: [field("next", "Node", "public")] }),
    ];
    const { edges } = buildClassCanvas(cg);
    expect(edges.filter((e) => e.data.kind === "association")).toHaveLength(0);
  });

  it("assigns unique edge ids so ReactFlow can key them", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { fields: [field("b", "B", "private")] }),
      cls("B", { fields: [field("a", "A", "private")] }),
    ];
    const { edges } = buildClassCanvas(cg);
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildClassCanvas · scope filtering", () => {
  it("respects folder scope", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("Auth", { filePath: "src/auth/Auth.ts" }),
      cls("Util", { filePath: "src/util/Util.ts" }),
    ];
    const { nodes } = buildClassCanvas(cg, {
      scope: { kind: "folder", folder: "src/auth" },
    });
    expect(nodes.map((n) => n.id)).toEqual(["Auth"]);
  });

  it("respects file scope", () => {
    const cg = emptyGraph();
    cg.classes = [
      cls("A", { filePath: "src/a.ts" }),
      cls("B", { filePath: "src/b.ts" }),
    ];
    const { nodes } = buildClassCanvas(cg, {
      scope: { kind: "file", filePath: "src/a.ts" },
    });
    expect(nodes.map((n) => n.id)).toEqual(["A"]);
  });
});

describe("buildClassCanvas · maxClasses cap", () => {
  it("caps at maxClasses, reports total in totalAvailable", () => {
    const cg = emptyGraph();
    cg.classes = Array.from({ length: 10 }, (_, i) =>
      cls(`C${i}`, { filePath: `src/c${i}.ts` })
    );
    const result = buildClassCanvas(cg, { maxClasses: 4 });
    expect(result.classCount).toBe(4);
    expect(result.totalAvailable).toBe(10);
    expect(result.nodes).toHaveLength(4);
  });
});

describe("layoutDagre · re-layout for filtered sets", () => {
  it("returns positions for every node in the input set", () => {
    const positions = layoutDagre(
      [
        { id: "A", width: 240, height: 100 },
        { id: "B", width: 240, height: 100 },
        { id: "C", width: 240, height: 100 },
      ],
      [{ source: "A", target: "B" }]
    );
    expect(positions.size).toBe(3);
    expect(positions.has("A")).toBe(true);
    expect(positions.has("B")).toBe(true);
    expect(positions.has("C")).toBe(true);
  });

  it("packs visible nodes tightly (NOT scattered across the unfiltered bbox)", () => {
    // The whole point of re-layout: when filters reduce the visible
    // set, positions should pack the survivors close together. Run
    // Dagre on a subset and verify the bbox is tight relative to
    // the original would-be layout.
    const fullPositions = layoutDagre(
      Array.from({ length: 20 }, (_, i) => ({
        id: `N${i}`,
        width: 240,
        height: 100,
      })),
      []
    );
    // Pretend filter survives only 3 of the 20.
    const subsetPositions = layoutDagre(
      [
        { id: "N0", width: 240, height: 100 },
        { id: "N1", width: 240, height: 100 },
        { id: "N2", width: 240, height: 100 },
      ],
      []
    );
    const fullSpan = bboxWidth(fullPositions);
    const subsetSpan = bboxWidth(subsetPositions);
    expect(subsetSpan).toBeLessThan(fullSpan);
  });

  it("places child below parent in TB layout", () => {
    const positions = layoutDagre(
      [
        { id: "Parent", width: 240, height: 100 },
        { id: "Child", width: 240, height: 100 },
      ],
      [{ source: "Parent", target: "Child" }]
    );
    expect(positions.get("Child")!.y).toBeGreaterThan(
      positions.get("Parent")!.y
    );
  });

  it("ignores edges referencing nodes outside the input set", () => {
    // Phantom edges shouldn't crash or distort layout. Common case:
    // visibleIds shrinks via filter, but we pass the unfiltered
    // edges array — extra edges should be silently dropped.
    const positions = layoutDagre(
      [{ id: "A", width: 240, height: 100 }],
      [
        { source: "A", target: "B" }, // B not in set
        { source: "Ghost", target: "A" }, // Ghost not in set
      ]
    );
    expect(positions.size).toBe(1);
    expect(Number.isFinite(positions.get("A")!.x)).toBe(true);
  });

  it("returns an empty Map for an empty node set", () => {
    const positions = layoutDagre([], []);
    expect(positions.size).toBe(0);
  });
});

function bboxWidth(positions: Map<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return maxX - minX;
}
