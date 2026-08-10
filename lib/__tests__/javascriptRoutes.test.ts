// Route handlers the JS/TS plugin declares as entry points.
//
// The false-positive cases matter more than the positive ones — the same rule
// python.test.ts states for decorators, and for the same reason: a wrong entry
// point invents reachability, and reachability is what the security layer
// suppresses findings with. A route we miss costs a finding; a route we invent
// costs the reader's trust in every finding.
//
// Next.js declares a route by FILE LOCATION plus an exported function named
// after the method. Three conditions have to hold at once — the file is named
// `route.<ext>`, it sits under `app/`, and the export is named for an HTTP verb
// — and each one of them is separately load-bearing. The negative blocks below
// remove one condition at a time.

import { describe, it, expect, beforeAll } from "vitest";

import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { parseFile } from "../codeAnalysis/parse";
import type {
  CallEdge,
  EntryPointInfo,
  FileIndex,
  FunctionDef,
  SourceFile,
} from "../codeAnalysis/types";
import type { AnalysisSnapshot } from "../types";
import { buildUnderstandBrief } from "../brief/understand";

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

describe("javascriptPlugin — Next.js route handlers", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  const parse = (content: string, rel: string) => {
    const ext = rel.slice(rel.lastIndexOf(".") + 1);
    const file: SourceFile = { rel, ext, content };
    return parseFile(javascriptPlugin, file, makeIndex([file]));
  };
  const entryOf = (
    content: string,
    name: string,
    rel = "app/api/items/route.ts",
  ): EntryPointInfo | undefined =>
    parse(content, rel).functions.find((f) => f.name === name)?.entryPoint;

  // ---- what a route looks like ----

  it("reads an exported async handler, method and path together", () => {
    expect(
      entryOf("export async function GET(req: Request) { return new Response(); }", "GET"),
    ).toEqual({
      kind: "http-route",
      methods: ["GET"],
      route: "/api/items",
      via: "export GET in route.ts",
    });
  });

  it("reads a non-async handler the same way", () => {
    expect(entryOf("export function POST(req: Request) { return null; }", "POST")?.methods).toEqual(
      ["POST"],
    );
  });

  it("reads the arrow form Next.js also serves", () => {
    expect(
      entryOf("export const DELETE = async (req: Request) => { return null; };", "DELETE"),
    ).toEqual({
      kind: "http-route",
      methods: ["DELETE"],
      route: "/api/items",
      via: "export DELETE in route.ts",
    });
  });

  it("marks every verb in a file that exports several", () => {
    const parsed = parse(
      "export async function GET() { return 1; }\n" +
        "export async function POST() { return 2; }\n" +
        "export async function DELETE() { return 3; }\n",
      "app/api/watches/route.ts",
    );
    const stamped = parsed.functions.filter((f) => f.entryPoint);
    expect(stamped.map((f) => f.name).sort()).toEqual(["DELETE", "GET", "POST"]);
    for (const f of stamped) expect(f.entryPoint!.route).toBe("/api/watches");
  });

  // ---- the path is the declaration, so its shape matters ----

  it("keeps dynamic segments exactly as written", () => {
    // `[id]` stays `[id]`. Rewriting it to `:id` would print a spelling the
    // repository never used.
    expect(
      entryOf(
        "export async function GET() { return 1; }",
        "GET",
        "app/api/sessions/[id]/brief/[subject]/route.ts",
      )?.route,
    ).toBe("/api/sessions/[id]/brief/[subject]");
  });

  it("drops route groups, which Next.js does not serve", () => {
    expect(
      entryOf("export async function GET() { return 1; }", "GET", "app/(marketing)/pricing/route.ts")
        ?.route,
    ).toBe("/pricing");
  });

  it("handles the src/app layout", () => {
    expect(
      entryOf("export async function GET() { return 1; }", "GET", "src/app/api/x/route.ts")?.route,
    ).toBe("/api/x");
  });

  it("gives the root route file the root path", () => {
    expect(entryOf("export async function GET() { return 1; }", "GET", "app/route.ts")?.route).toBe(
      "/",
    );
  });

  it("reads .js, .jsx and .mts route files too", () => {
    for (const rel of ["app/api/x/route.js", "app/api/x/route.jsx", "app/api/x/route.mts"]) {
      expect(
        entryOf("export async function GET() { return 1; }", "GET", rel),
        rel,
      ).toBeDefined();
    }
  });

  // ---- each condition, removed one at a time ----

  it("declines a handler that is not exported", () => {
    // Next.js serves exports. A local helper named GET is not a route, and
    // stamping it would invent an entry point in a file that really has one.
    expect(
      entryOf(
        "function GET() { return 1; }\nexport async function POST() { return GET(); }",
        "GET",
      ),
    ).toBeUndefined();
  });

  it("declines an export whose name is not an HTTP verb", () => {
    expect(
      entryOf("export async function handler(req: Request) { return 1; }", "handler"),
    ).toBeUndefined();
    expect(entryOf("export const runtime = () => 'edge';", "runtime")).toBeUndefined();
  });

  it("declines a lowercase verb", () => {
    // Next.js matches the exact uppercase name. `get` is an ordinary export.
    expect(entryOf("export async function get() { return 1; }", "get")).toBeUndefined();
  });

  it("declines a verb-named export in a file that is not route.*", () => {
    // The filename is what makes it a declaration. Without it this is a module
    // that happens to export something called GET.
    for (const rel of ["app/api/items/handlers.ts", "app/api/items/index.ts", "lib/http.ts"]) {
      expect(
        entryOf("export async function GET() { return 1; }", "GET", rel),
        rel,
      ).toBeUndefined();
    }
  });

  it("declines a route.ts outside app/", () => {
    for (const rel of ["lib/route.ts", "pages/api/route.ts", "route.ts"]) {
      expect(
        entryOf("export async function GET() { return 1; }", "GET", rel),
        rel,
      ).toBeUndefined();
    }
  });

  it("declines Next's other reserved files, which export a default named function", () => {
    // Measured on this repo: app/sitemap.ts, app/robots.ts and app/manifest.ts
    // all export a default named function and serve no route. A rule keyed on
    // "lives under app/" would stamp all three.
    for (const rel of ["app/sitemap.ts", "app/robots.ts", "app/manifest.ts"]) {
      const parsed = parse("export default function sitemap() { return []; }", rel);
      expect(
        parsed.functions.filter((f) => f.entryPoint),
        rel,
      ).toEqual([]);
    }
  });

  it("declines the destructured re-export, rather than guessing at it", () => {
    // A real file in this repo: app/api/auth/[...all]/route.ts says
    // `export const { GET, POST } = toNextJsHandler(auth)`. There is no function
    // node to stamp — the handlers live inside better-auth. A known miss, and
    // the honest one: we do not invent a function that is not here.
    const parsed = parse(
      "import { toNextJsHandler } from 'better-auth/next-js';\n" +
        "export const { GET, POST } = toNextJsHandler(auth);\n",
      "app/api/auth/[...all]/route.ts",
    );
    expect(parsed.functions.filter((f) => f.entryPoint)).toEqual([]);
  });

  // ---- the shape we deliberately do not read ----

  it("does not read app.get(), where a client call is indistinguishable", () => {
    // Express/Hono registration is NOT stamped, and this is a decision rather
    // than an oversight. Measured: 30 of 42 real registrations in node_modules
    // pass an inline anonymous arrow, which this plugin does not emit at all;
    // and `api.post("/messages", body)` against an axios instance — 114
    // two-argument occurrences across the bench repos — is syntactically the
    // same call. Telling them apart needs receiver-origin analysis.
    const parsed = parse(
      "const app = express();\n" +
        "app.get('/users', listUsers);\n" +
        "function listUsers(req, res) { res.json([]); }\n",
      "server/index.ts",
    );
    expect(parsed.functions.find((f) => f.name === "listUsers")?.entryPoint).toBeUndefined();
    expect(parsed.routes ?? []).toEqual([]);
  });

  it("does not stamp an HTTP client call that looks exactly like a route", () => {
    const parsed = parse(
      "const api = axios.create({ baseURL: '/api' });\n" +
        "export async function send(body) { return api.post('/messages', body); }\n",
      "src/pages/Messages.ts",
    );
    expect(parsed.functions.find((f) => f.name === "send")?.entryPoint).toBeUndefined();
  });

  // ---- non-regression ----

  it("leaves ordinary files completely unstamped", () => {
    const parsed = parse(
      "export function add(a: number, b: number) { return a + b; }\n" +
        "export const mul = (a: number, b: number) => a * b;\n",
      "lib/math.ts",
    );
    expect(parsed.functions).toHaveLength(2);
    expect(parsed.functions.every((f) => f.entryPoint === undefined)).toBe(true);
  });

  it("still records the handler's own calls and complexity", () => {
    // The stamp is additive. If it ever replaced the normal function record,
    // every route handler would drop out of blast radius and duplicate
    // detection at once.
    const parsed = parse(
      "export async function GET(req: Request) {\n" +
        "  if (req.headers.get('x')) { return helper(1); }\n" +
        "  return helper(2);\n" +
        "}\n",
      "app/api/items/route.ts",
    );
    const fn = parsed.functions.find((f) => f.name === "GET")!;
    expect(fn.entryPoint).toBeDefined();
    expect(fn.complexity).toBeGreaterThan(1);
    expect(fn.bodyHash).toBeDefined();
    expect(parsed.calls.some((c) => c.calleeName === "helper")).toBe(true);
  });
});

// The brief is where a declared route becomes something a reader acts on, and
// it was rendering the category name ("A declared route-like") while holding
// the URL. These assert the handoff, because the plugin producing a route and
// the page showing it are two different things that can each be right alone.
describe("the brief shows the route, not our word for it", () => {
  const graphWith = (fns: FunctionDef[], calls: CallEdge[] = []): AnalysisSnapshot =>
    ({
      repo: { fullName: "acme/api" },
      codeGraph: {
        functions: fns,
        calls,
        imports: [],
        fileComplexity: {},
        filesByExt: {},
        byPlugin: {},
      },
    }) as unknown as AnalysisSnapshot;

  const handler = (
    filePath: string,
    name: string,
    entryPoint?: EntryPointInfo,
  ): FunctionDef =>
    ({ filePath, name, startRow: 0, endRow: 5, complexity: 2, entryPoint }) as FunctionDef;

  const doorsOf = (snap: AnalysisSnapshot) =>
    buildUnderstandBrief(snap, "s1").sections.find((s) => s.id === "doors")?.items ?? [];

  it("titles a door with its method and path", () => {
    const snap = graphWith(
      [
        handler("app/api/items/route.ts", "GET", {
          kind: "http-route",
          methods: ["GET"],
          route: "/api/items",
          via: "export GET in route.ts",
        }),
        handler("lib/db.ts", "load"),
      ],
      [
        {
          fromFile: "app/api/items/route.ts",
          fromFunction: "GET",
          toFile: "lib/db.ts",
          toFunction: "load",
          calleeName: "load",
        } as unknown as CallEdge,
      ],
    );
    const doors = doorsOf(snap);
    expect(doors).toHaveLength(1);
    expect(doors[0].title).toContain("GET /api/items");
    expect(doors[0].evidence, "the evidence should name what matched").toContain(
      "export GET in route.ts",
    );
    expect(doors[0].evidence, "route-like is a category, not evidence").not.toContain(
      "route-like",
    );
  });

  it("falls back to the function name when a declaration carries no path", () => {
    // Flask's `@app.websocket` declares an entry point with no route string.
    // The door must still render rather than showing "undefined".
    const snap = graphWith(
      [
        handler("api.py", "stream", { kind: "http-route", via: "@app.websocket" }),
        handler("lib/db.py", "load"),
      ],
      [
        {
          fromFile: "api.py",
          fromFunction: "stream",
          toFile: "lib/db.py",
          toFunction: "load",
          calleeName: "load",
        } as unknown as CallEdge,
      ],
    );
    const doors = doorsOf(snap);
    expect(doors).toHaveLength(1);
    expect(doors[0].title).toContain("stream");
    expect(doors[0].title).not.toContain("undefined");
  });

  it("changes the whole answer, which is the point of the feature", () => {
    const withRoute = graphWith([
      handler("app/api/x/route.ts", "GET", {
        kind: "http-route",
        methods: ["GET"],
        route: "/api/x",
        via: "export GET in route.ts",
      }),
      handler("lib/db.ts", "load"),
    ], [
      {
        fromFile: "app/api/x/route.ts",
        fromFunction: "GET",
        toFile: "lib/db.ts",
        toFunction: "load",
        calleeName: "load",
      } as unknown as CallEdge,
    ]);
    expect(buildUnderstandBrief(withRoute, "s1").answer).toContain("way");
    expect(buildUnderstandBrief(withRoute, "s1").answer).not.toContain(
      "Nothing declares itself",
    );
  });
});
