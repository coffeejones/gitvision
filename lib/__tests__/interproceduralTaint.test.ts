// Tests for taint that crosses function boundaries.
//
// The negative cases carry the weight, as everywhere else in this layer: a
// wrong flow invents a vulnerability and hands a reader a path that does not
// exist, which is worse than saying nothing.

import { describe, it, expect } from "vitest";
import { computeInterproceduralTaint, formatTaintFlow } from "../security/interproceduralTaint";
import type {
  CallEdge,
  CodeGraph,
  FunctionDef,
  SinkGraphEntry,
} from "../codeAnalysis/types";

function fn(filePath: string, name: string, params?: string[]): FunctionDef {
  return { filePath, name, startRow: 0, endRow: 9, complexity: 1, ...(params ? { params } : {}) };
}
function routeFn(filePath: string, name: string, params: string[], route = "/x"): FunctionDef {
  return {
    ...fn(filePath, name, params),
    entryPoint: { kind: "http-route", route, via: "path()" },
  };
}
function call(
  fromFile: string,
  fromFunction: string,
  toFile: string,
  toFunction: string,
  taintedArgs?: CallEdge["taintedArgs"]
): CallEdge {
  return { fromFile, fromFunction, calleeName: toFunction, toFile, toFunction, taintedArgs };
}
function sink(filePath: string, inFunction: string, taintedByParam?: string): SinkGraphEntry {
  return {
    filePath,
    ruleId: "py-os-command",
    severity: "high",
    line: 5,
    inFunction,
    snippet: "os.system(cmd)",
    ...(taintedByParam ? { taintedByParam } : {}),
  };
}
function graph(functions: FunctionDef[], calls: CallEdge[], sinks: SinkGraphEntry[]): CodeGraph {
  return { functions, calls, imports: [], fileComplexity: {}, filesByExt: {}, byPlugin: {}, sinks };
}
const only = (m: Map<string, unknown>) => [...m.values()][0] as { source: string; hops?: { name: string }[] };

describe("computeInterproceduralTaint", () => {
  it("carries request data from a caller into a callee's sink", () => {
    const cg = graph(
      [fn("views.py", "view"), fn("shell.py", "run", ["cmd"])],
      [
        call("views.py", "view", "shell.py", "run", [
          { index: 0, source: "request.POST", line: 2 },
        ]),
      ],
      [sink("shell.py", "run", "cmd")]
    );
    const out = computeInterproceduralTaint(cg);
    expect(out.size).toBe(1);
    expect(only(out).source).toBe("request.POST");
    expect(only(out).hops?.map((h) => h.name)).toEqual(["view", "run"]);
  });

  it("follows a value through an intermediate layer", () => {
    // view -> service -> repo, which is the shape slice 5 could never see.
    const cg = graph(
      [fn("views.py", "view"), fn("svc.py", "handle", ["q"]), fn("repo.py", "exec_sql", ["sql"])],
      [
        call("views.py", "view", "svc.py", "handle", [
          { index: 0, source: "request.GET", line: 3 },
        ]),
        call("svc.py", "handle", "repo.py", "exec_sql", [{ index: 0, param: "q", line: 8 }]),
      ],
      [sink("repo.py", "exec_sql", "sql")]
    );
    const out = computeInterproceduralTaint(cg);
    expect(only(out).hops?.map((h) => h.name)).toEqual(["view", "handle", "exec_sql"]);
    expect(formatTaintFlow(only(out) as never)).toBe(
      "request.GET → view() → handle() → exec_sql()"
    );
  });

  it("seeds a declared route handler's own parameters", () => {
    // The half slice 5 structurally could not reach: only the graph knows this
    // function is a route handler, because the URLconf saying so is elsewhere.
    const cg = graph(
      [routeFn("views.py", "search", ["request", "q"], "/search"), fn("db.py", "run", ["sql"])],
      [call("views.py", "search", "db.py", "run", [{ index: 0, param: "q", line: 4 }])],
      [sink("db.py", "run", "sql")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(1);
  });

  it("does not treat `request` itself as untrusted input", () => {
    const cg = graph(
      [routeFn("views.py", "view", ["request"]), fn("shell.py", "run", ["cmd"])],
      [call("views.py", "view", "shell.py", "run", [{ index: 0, param: "request", line: 2 }])],
      [sink("shell.py", "run", "cmd")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(0);
  });

  it("maps the argument POSITION onto the right parameter", () => {
    const cg = graph(
      [fn("views.py", "view"), fn("shell.py", "run", ["safe", "cmd"])],
      [
        call("views.py", "view", "shell.py", "run", [
          { index: 1, source: "request.POST", line: 2 },
        ]),
      ],
      [sink("shell.py", "run", "cmd"), sink("shell.py", "run", "safe")]
    );
    // Only the sink consuming parameter 1 is fed.
    expect(computeInterproceduralTaint(cg).size).toBe(1);
  });

  it("matches keyword arguments by name", () => {
    const cg = graph(
      [fn("views.py", "view"), fn("shell.py", "run", ["a", "cmd"])],
      [
        call("views.py", "view", "shell.py", "run", [
          { index: -1, name: "cmd", source: "request.POST", line: 2 },
        ]),
      ],
      [sink("shell.py", "run", "cmd")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(1);
  });

  it("does NOT follow an unresolved call edge", () => {
    // Same discipline as reachability: an edge we could not resolve is not
    // evidence, and a path built on one would be fiction.
    const cg = graph(
      [fn("views.py", "view"), fn("shell.py", "run", ["cmd"])],
      [
        {
          fromFile: "views.py",
          fromFunction: "view",
          calleeName: "run",
          toFile: null,
          toFunction: null,
          taintedArgs: [{ index: 0, source: "request.POST", line: 2 }],
        },
      ],
      [sink("shell.py", "run", "cmd")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(0);
  });

  it("does not claim a flow when nothing untrusted is passed", () => {
    const cg = graph(
      [fn("views.py", "view"), fn("shell.py", "run", ["cmd"])],
      [call("views.py", "view", "shell.py", "run")],
      [sink("shell.py", "run", "cmd")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(0);
  });

  it("ignores flows that start in a test file", () => {
    const cg = graph(
      [fn("tests/test_x.py", "test_run"), fn("shell.py", "run", ["cmd"])],
      [
        call("tests/test_x.py", "test_run", "shell.py", "run", [
          { index: 0, source: "request.POST", line: 2 },
        ]),
      ],
      [sink("shell.py", "run", "cmd")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(0);
  });

  it("terminates on a recursive call cycle", () => {
    const cg = graph(
      [fn("views.py", "view"), fn("a.py", "a", ["x"]), fn("b.py", "b", ["y"])],
      [
        call("views.py", "view", "a.py", "a", [{ index: 0, source: "request.POST", line: 1 }]),
        call("a.py", "a", "b.py", "b", [{ index: 0, param: "x", line: 2 }]),
        call("b.py", "b", "a.py", "a", [{ index: 0, param: "y", line: 3 }]),
      ],
      [sink("b.py", "b", "y")]
    );
    expect(computeInterproceduralTaint(cg).size).toBe(1);
  });

  it("leaves an already-proven intraprocedural finding alone", () => {
    const s = sink("shell.py", "run", "cmd");
    s.taint = { source: "request.GET", line: 4 };
    const cg = graph([fn("shell.py", "run", ["cmd"])], [], [s]);
    expect(computeInterproceduralTaint(cg).size).toBe(0);
  });

  it("returns nothing for a graph with no sinks", () => {
    expect(computeInterproceduralTaint(graph([fn("a.py", "a")], [], [])).size).toBe(0);
  });
});
