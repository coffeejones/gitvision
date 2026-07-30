// Tests for the reachability filter — the classification the whole security
// layer rests on. Hand-built graphs, no tree-sitter.
//
// The states that DON'T claim reachability carry most of the weight here. A
// wrong `reachable` overstates one finding; a wrong `unreachable` hides one,
// and hides it confidently.

import { describe, it, expect } from "vitest";
import { classifySinks, formatPath , isNonProductionPath} from "../security/reachability";
import type {
  CallEdge,
  CodeGraph,
  FunctionDef,
  SinkGraphEntry,
} from "../codeAnalysis/types";

function fn(filePath: string, name: string): FunctionDef {
  return { filePath, name, startRow: 0, endRow: 5, complexity: 1 };
}
function routeFn(filePath: string, name: string, route: string, methods?: string[]): FunctionDef {
  return {
    ...fn(filePath, name),
    entryPoint: {
      kind: "http-route",
      route,
      via: "@app.route",
      ...(methods ? { methods } : {}),
    },
  };
}
function call(fromFile: string, fromFunction: string, toFile: string, toFunction: string): CallEdge {
  return { fromFile, fromFunction, calleeName: toFunction, toFile, toFunction };
}
function sink(filePath: string, inFunction: string | null, over: Partial<SinkGraphEntry> = {}): SinkGraphEntry {
  return {
    filePath,
    ruleId: "py-eval",
    severity: "high",
    line: 10,
    inFunction,
    snippet: "eval(x)",
    ...over,
  };
}
function graph(functions: FunctionDef[], calls: CallEdge[], sinks: SinkGraphEntry[]): CodeGraph {
  return { functions, calls, imports: [], fileComplexity: {}, filesByExt: {}, byPlugin: {}, sinks };
}

describe("classifySinks", () => {
  it("marks a sink in a route handler reachable, with a one-hop path", () => {
    const cg = graph(
      [routeFn("views.py", "search", "/search", ["GET"]), fn("db.py", "query")],
      [call("views.py", "search", "db.py", "query")],
      [sink("views.py", "search")]
    );
    const [f] = classifySinks(cg).findings;
    expect(f.reachability).toBe("reachable");
    expect(f.path?.hops.map((h) => h.name)).toEqual(["search"]);
    expect(f.path?.entry).toMatchObject({ route: "/search", methods: ["GET"], declared: true });
  });

  it("traces a multi-hop path from the entry point to the sink's function", () => {
    const cg = graph(
      [
        routeFn("views.py", "handler", "/run"),
        fn("service.py", "process"),
        fn("shell.py", "run_cmd"),
      ],
      [
        call("views.py", "handler", "service.py", "process"),
        call("service.py", "process", "shell.py", "run_cmd"),
      ],
      [sink("shell.py", "run_cmd", { ruleId: "py-os-command" })]
    );
    const [f] = classifySinks(cg).findings;
    expect(f.reachability).toBe("reachable");
    expect(f.path?.hops.map((h) => h.name)).toEqual(["handler", "process", "run_cmd"]);
    expect(formatPath(f.path!)).toBe("ANY /run → handler() → process() → run_cmd()");
  });

  it("says unknown when something calls the function but no route reaches it", () => {
    const cg = graph(
      [routeFn("views.py", "home", "/"), fn("a.py", "caller"), fn("b.py", "helper")],
      [call("a.py", "caller", "b.py", "helper")],
      [sink("b.py", "helper")]
    );
    const [f] = classifySinks(cg).findings;
    expect(f.reachability).toBe("unknown");
    expect(f.path).toBeUndefined();
  });

  it("says unreachable only when nothing calls it and routes ARE understood", () => {
    const cg = graph(
      [routeFn("views.py", "home", "/"), fn("dead.py", "orphan")],
      [],
      [sink("dead.py", "orphan")]
    );
    expect(classifySinks(cg).findings[0].reachability).toBe("unreachable");
  });

  it("never says unreachable when the repo has NO entry points", () => {
    // VAmPI's shape: routing lives in a spec file no reader covers, so every
    // handler looks uncalled. Calling those dead would hide real findings.
    const cg = graph([fn("models.py", "get_user")], [], [sink("models.py", "get_user")]);
    const r = classifySinks(cg);
    expect(r.entryPoints).toBe(0);
    expect(r.findings[0].reachability).toBe("unknown");
    expect(r.counts.unreachable).toBe(0);
  });

  it("treats a sink whose function we never indexed as unknown, not dead", () => {
    const cg = graph([routeFn("views.py", "home", "/")], [], [sink("ghost.py", "vanished")]);
    expect(classifySinks(cg).findings[0].reachability).toBe("unknown");
  });

  it("classifies a template sink as unknown, not module-scope", () => {
    // A template has no function and no call edge. It must not be called
    // module-scope (which means "runs at import"), and must not be suppressed —
    // we found an escape-disabled interpolation, we just can't link it to a view.
    const s = sink("templates/page.html", null, { ruleId: "py-template-safe-filter", origin: "template" });
    const cg = graph([routeFn("views.py", "home", "/")], [], [s]);
    const r = classifySinks(cg);
    expect(r.findings[0].reachability).toBe("unknown");
    expect(r.counts["module-scope"]).toBe(0);
  });

  it("classifies a module-scope sink separately — it runs, but not from a route", () => {
    const cg = graph([routeFn("views.py", "home", "/")], [], [sink("boot.py", null)]);
    const r = classifySinks(cg);
    expect(r.findings[0].reachability).toBe("module-scope");
    expect(r.counts["module-scope"]).toBe(1);
  });

  it("ignores sinks in test files, across Python's naming conventions", () => {
    const cg = graph(
      [routeFn("views.py", "home", "/")],
      [],
      [
        sink("app/tests/test_thing.py", "test_it"),
        sink("app/thing_test.py", "test_it"),
        sink("app/tests/helpers.py", "make"),
        sink("boot.py", null),
      ]
    );
    const r = classifySinks(cg);
    expect(r.total).toBe(1);
    expect(r.findings[0].filePath).toBe("boot.py");
  });

  it("ranks proven reach above severity — a reachable medium beats an unknown high", () => {
    // The whole point of the filter: a vulnerability nobody can trigger is not
    // more urgent than a weaker one that is exposed.
    const cg = graph(
      [routeFn("views.py", "home", "/"), fn("x.py", "caller"), fn("y.py", "buried")],
      [call("x.py", "caller", "y.py", "buried")],
      [
        sink("y.py", "buried", { ruleId: "py-eval", severity: "high" }),
        sink("views.py", "home", { ruleId: "py-tls-verify-disabled", severity: "medium" }),
      ]
    );
    const { findings } = classifySinks(cg);
    expect(findings.map((f) => f.ruleId)).toEqual(["py-tls-verify-disabled", "py-eval"]);
    expect(findings.map((f) => f.reachability)).toEqual(["reachable", "unknown"]);
  });

  it("orders by severity within the same reachability state", () => {
    const cg = graph(
      [routeFn("views.py", "home", "/")],
      [],
      [
        sink("views.py", "home", { ruleId: "py-sql-assembled", severity: "low", line: 1 }),
        sink("views.py", "home", { ruleId: "py-eval", severity: "high", line: 2 }),
        sink("views.py", "home", { ruleId: "py-tls-verify-disabled", severity: "medium", line: 3 }),
      ]
    );
    expect(classifySinks(cg).findings.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
  });

  it("reports counts and the entry-point total", () => {
    const cg = graph(
      [routeFn("views.py", "home", "/"), fn("dead.py", "orphan")],
      [],
      [sink("views.py", "home"), sink("dead.py", "orphan"), sink("boot.py", null)]
    );
    const r = classifySinks(cg);
    expect(r.counts).toEqual({ reachable: 1, unknown: 0, unreachable: 1, "module-scope": 1 });
    expect(r.total).toBe(3);
    expect(r.entryPoints).toBe(1);
  });

  it("returns an empty report for a graph with no sinks", () => {
    const r = classifySinks(graph([fn("a.py", "a")], [], []));
    expect(r.findings).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("is deterministic for identically-ranked findings", () => {
    const build = () =>
      graph(
        [routeFn("views.py", "home", "/")],
        [],
        [
          sink("b.py", null, { ruleId: "py-eval", line: 5 }),
          sink("a.py", null, { ruleId: "py-eval", line: 5 }),
        ]
      );
    const first = classifySinks(build()).findings.map((f) => f.filePath);
    const second = classifySinks(build()).findings.map((f) => f.filePath);
    expect(first).toEqual(["a.py", "b.py"]);
    expect(second).toEqual(first);
  });

  it("formats a heuristic entry point by name, since it has no route to show", () => {
    const cg = graph(
      [fn("app/api/handler.py", "handle_request")],
      [call("app/api/handler.py", "handle_request", "db.py", "q")],
      [sink("app/api/handler.py", "handle_request")]
    );
    const [f] = classifySinks(cg).findings;
    expect(f.reachability).toBe("reachable");
    expect(f.path?.entry.declared).toBe(false);
    expect(formatPath(f.path!)).toBe("handle_request → handle_request()");
  });
});

// The single largest false-positive source measured on realistic applications
// (§4w): 57% of all FPs across 39 business apps were in files that exist to set
// the app up, not to serve it. The tuning corpus contains none of these,
// because deliberately-vulnerable teaching apps have no tests and no seed data.
describe("isNonProductionPath", () => {
  it("recognises setup and fixture code", () => {
    for (const p of [
      "crm/tests.py",
      "accounts/management/commands/seed_demo.py",
      "backend/app/seed.py",
      "app/conftest.py",
      "core/migrations/0002_add_user.py",
      "shop/factories.py",
      "tests/fixtures/data.py",
      "scripts/create_db.py",
    ]) {
      expect(isNonProductionPath(p)).toBe(true);
    }
  });

  it("does NOT swallow application code", () => {
    for (const p of [
      "app/views.py",
      "backend/app/routers/users.py",
      "crm/models.py",
      "portal_core/files.py",
      "app/services/seeding_service.py", // "seed" inside a longer word
      "api/commands.py", // not under management/
    ]) {
      expect(isNonProductionPath(p)).toBe(false);
    }
  });
});
