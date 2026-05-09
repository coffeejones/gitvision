// Golden TypeScript fixture — types/interfaces (no functions),
// generics, class methods with type signatures, cross-file resolution.

import { describe, it, expect, beforeAll } from "vitest";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
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

const TYPES_TS = `export interface User {
  name: string;
  age: number;
}

export type Predicate<T> = (item: T) => boolean;
`;

const HELPER_TS = `import type { User } from './types';

export function isAdult(user: User): boolean {
  return user.age >= 18;
}
`;

const SERVICE_TS = `import type { User, Predicate } from './types';
import { isAdult } from './helper';

export class UserService {
  count(users: User[]): number {
    let n = 0;
    for (const u of users) {
      if (isAdult(u)) {
        n++;
      }
    }
    return n;
  }

  filter<T>(items: T[], pred: Predicate<T>): T[] {
    return items.filter(pred);
  }
}
`;

// HAND-COUNTED:
// types.ts:    0 functions (interface + type alias only)
// helper.ts:   1 function (isAdult, complexity 1)
// service.ts:  2 methods (count, filter) on UserService
//   count   → for + if          → complexity 3
//   filter  → no decisions      → complexity 1
// Cross-file: count calls isAdult → resolves to helper.ts
// Imports: 2 type-only imports + 1 value import

describe("golden TypeScript fixture", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  function buildGraph() {
    const types: SourceFile = { rel: "src/types.ts", ext: "ts", content: TYPES_TS };
    const helper: SourceFile = { rel: "src/helper.ts", ext: "ts", content: HELPER_TS };
    const service: SourceFile = { rel: "src/service.ts", ext: "ts", content: SERVICE_TS };
    const ix = makeIndex([types, helper, service]);
    const pt = parseFile(javascriptPlugin, types, ix);
    const ph = parseFile(javascriptPlugin, helper, ix);
    const ps = parseFile(javascriptPlugin, service, ix);
    return buildCodeGraph({
      parsedFiles: [pt, ph, ps],
      pluginByFile: new Map([
        ["src/types.ts", "javascript"],
        ["src/helper.ts", "javascript"],
        ["src/service.ts", "javascript"],
      ]),
    });
  }

  it("extracts exactly 3 functions (interfaces don't count)", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("function names match exactly", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["count", "filter", "isAdult"]);
  });

  it("types.ts produces no functions", () => {
    const g = buildGraph();
    const fromTypes = g.functions.filter((f) => f.filePath === "src/types.ts");
    expect(fromTypes).toEqual([]);
  });

  it("class method count has UserService as containerType", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "count")?.containerType).toBe("UserService");
  });

  it("generic method filter is extracted with right container", () => {
    const g = buildGraph();
    const fn = g.functions.find((f) => f.name === "filter");
    expect(fn).toBeDefined();
    expect(fn?.containerType).toBe("UserService");
  });

  it("complexity of isAdult is 1", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "isAdult")?.complexity).toBe(1);
  });

  it("complexity of count is 3 (for + if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "count")?.complexity).toBe(3);
  });

  it("complexity of filter is 1 (no decisions)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "filter")?.complexity).toBe(1);
  });

  it("import resolution: service.ts -> helper.ts", () => {
    const g = buildGraph();
    const imp = g.imports.find((i) => i.from === "src/service.ts" && i.to === "src/helper.ts");
    expect(imp).toBeDefined();
  });

  it("isAdult() call from count resolves cross-file to helper.ts", () => {
    const g = buildGraph();
    const call = g.calls.find(
      (c) => c.fromFunction === "count" && c.calleeName === "isAdult"
    );
    expect(call?.toFile).toBe("src/helper.ts");
  });
});
