// Tests for the Python tree-sitter plugin. Covers:
//   1. Grammar boots and parses real Python without errors
//   2. Queries extract imports, function defs, call sites, decision points
//   3. Resolver matches lib/graph.ts:resolvePython behavior — same paths
//      resolve, same fall-through to package + fuzzy suffix match

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { pythonPlugin } from "../codeAnalysis/plugins/python";
import { parseFile } from "../codeAnalysis/parse";
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

describe("pythonPlugin — basic contract", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("advertises the .py extension only", () => {
    expect([...pythonPlugin.extensions]).toEqual(["py"]);
  });

  it("loads the tree-sitter-python grammar", () => {
    expect(pythonPlugin.languageFor("py")).toBeTruthy();
  });

  it("parses a simple Python module without error", () => {
    const lang = pythonPlugin.languageFor("py");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(
      "def hi(name):\n    return f'hello, {name}'\n"
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.type).toBe("module");
    parser.delete();
    tree!.delete();
  });
});

describe("pythonPlugin.resolveImport", () => {
  const files: SourceFile[] = [
    { rel: "pkg/__init__.py", ext: "py", content: "" },
    { rel: "pkg/main.py", ext: "py", content: "" },
    { rel: "pkg/helper.py", ext: "py", content: "" },
    { rel: "pkg/sub/__init__.py", ext: "py", content: "" },
    { rel: "pkg/sub/util.py", ext: "py", content: "" },
    { rel: "src/app/cli.py", ext: "py", content: "" },
  ];
  const ix = makeIndex(files);

  it("resolves a sibling module via `from .helper import x`", () => {
    expect(
      pythonPlugin.resolveImport(".helper", "pkg/main.py", ix)
    ).toBe("pkg/helper.py");
  });

  it("`from . import x` resolves to the current package's __init__.py", () => {
    expect(pythonPlugin.resolveImport(".", "pkg/main.py", ix)).toBe(
      "pkg/__init__.py"
    );
  });

  it("resolves a sub-package via `from .sub import x`", () => {
    expect(pythonPlugin.resolveImport(".sub", "pkg/main.py", ix)).toBe(
      "pkg/sub/__init__.py"
    );
  });

  it("`from .sub.util import f` resolves to the sub-package's util.py", () => {
    expect(pythonPlugin.resolveImport(".sub.util", "pkg/main.py", ix)).toBe(
      "pkg/sub/util.py"
    );
  });

  it("walks up with `..` for parent-package imports", () => {
    // From pkg/sub/util.py, `from ..helper import x` → pkg/helper.py
    expect(
      pythonPlugin.resolveImport("..helper", "pkg/sub/util.py", ix)
    ).toBe("pkg/helper.py");
  });

  it("resolves an absolute package path via fuzzy suffix match", () => {
    // `from app.cli import main` from anywhere → src/app/cli.py
    expect(
      pythonPlugin.resolveImport("app.cli", "pkg/main.py", ix)
    ).toBe("src/app/cli.py");
  });

  it("returns null for stdlib / external imports", () => {
    expect(pythonPlugin.resolveImport("os", "pkg/main.py", ix)).toBeNull();
    expect(
      pythonPlugin.resolveImport("requests", "pkg/main.py", ix)
    ).toBeNull();
  });

  it("returns null when relative depth exceeds the from-file's directory", () => {
    // pkg/main.py is one level deep; ... would go above repo root.
    expect(
      pythonPlugin.resolveImport("...too.far", "pkg/main.py", ix)
    ).toBeNull();
  });
});

describe("pythonPlugin — parseFile end-to-end", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("extracts absolute and relative imports", () => {
    const content =
      "import os\n" +
      "import os.path as op\n" +
      "from typing import List\n" +
      "from .helper import work\n" +
      "from . import siblings\n" +
      "from ..pkg import deep\n";
    const file: SourceFile = { rel: "pkg/main.py", ext: "py", content };
    const ix = makeIndex([file, { rel: "pkg/helper.py", ext: "py", content: "" }]);
    const parsed = parseFile(pythonPlugin, file, ix);

    expect(parsed.parseError).toBe(false);
    const specs = parsed.imports.map((i) => i.rawSpec).sort();
    expect(specs).toContain("os");
    expect(specs).toContain("os.path");
    expect(specs).toContain("typing");
    expect(specs).toContain(".helper");
    expect(specs).toContain(".");
    expect(specs).toContain("..pkg");

    // .helper resolves to a real file
    const helperImport = parsed.imports.find((i) => i.rawSpec === ".helper");
    expect(helperImport?.resolvedPath).toBe("pkg/helper.py");
    // os is external
    expect(parsed.imports.find((i) => i.rawSpec === "os")?.resolvedPath).toBeNull();
  });

  it("extracts top-level functions and methods", () => {
    const content =
      "def top():\n" +
      "    return 1\n" +
      "\n" +
      "class Widget:\n" +
      "    def render(self):\n" +
      "        return None\n" +
      "    def update(self, x):\n" +
      "        if x > 0:\n" +
      "            return x\n" +
      "        else:\n" +
      "            return 0\n";
    const file: SourceFile = { rel: "w.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const names = parsed.functions.map((f) => f.name).sort();
    expect(names).toEqual(["render", "top", "update"]);
  });

  it("computes cyclomatic complexity from Python decision points", () => {
    const content =
      "def simple():\n" +
      "    return 1\n" +
      "\n" +
      "def branchy(x):\n" +
      "    if x > 0:\n" +
      "        for i in range(x):\n" +
      "            if i % 2 == 0 and i > 2:\n" +
      "                print(i)\n" +
      "    elif x == 0:\n" +
      "        return 'zero'\n" +
      "    else:\n" +
      "        try:\n" +
      "            return -x\n" +
      "        except ValueError:\n" +
      "            return 0\n" +
      "    return x if x else 0\n";
    const file: SourceFile = { rel: "b.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const simple = parsed.functions.find((f) => f.name === "simple");
    const branchy = parsed.functions.find((f) => f.name === "branchy");
    expect(simple?.complexity).toBe(1);
    // branchy: 1 base + if + for + if + (and: boolean_operator) + elif +
    //   except + ternary (conditional_expression) = 8
    expect(branchy?.complexity).toBe(8);
  });

  it("attributes calls to their enclosing function/method", () => {
    const content =
      "def outer():\n" +
      "    helper()\n" +
      "    return inner()\n" +
      "\n" +
      "def inner():\n" +
      "    return util()\n" +
      "\n" +
      "def helper():\n" +
      "    pass\n" +
      "\n" +
      "def util():\n" +
      "    pass\n" +
      "\n" +
      "top_level()\n";
    const file: SourceFile = { rel: "c.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);

    const outerCalls = parsed.calls
      .filter((c) => c.inFunction === "outer")
      .map((c) => c.calleeName)
      .sort();
    expect(outerCalls).toEqual(["helper", "inner"]);

    const innerCalls = parsed.calls
      .filter((c) => c.inFunction === "inner")
      .map((c) => c.calleeName);
    expect(innerCalls).toEqual(["util"]);

    const moduleScope = parsed.calls
      .filter((c) => c.inFunction === null)
      .map((c) => c.calleeName);
    expect(moduleScope).toEqual(["top_level"]);
  });

  it("captures attribute method calls (obj.method())", () => {
    const content =
      "def use():\n" +
      "    items.append(1)\n" +
      "    other.nested.deep()\n";
    const file: SourceFile = { rel: "m.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const callees = parsed.calls.map((c) => c.calleeName).sort();
    expect(callees).toContain("append");
    expect(callees).toContain("deep");
  });
});

describe("pythonPlugin — type-aware tracking (v0.18)", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("emits containerType on class methods", () => {
    const content =
      "class Service:\n" +
      "    def run(self):\n" +
      "        pass\n" +
      "    def stop(self):\n" +
      "        pass\n" +
      "\n" +
      "def free_fn():\n" +
      "    pass\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const run = parsed.functions.find((f) => f.name === "run");
    const stop = parsed.functions.find((f) => f.name === "stop");
    const free = parsed.functions.find((f) => f.name === "free_fn");
    expect(run?.containerType).toBe("Service");
    expect(stop?.containerType).toBe("Service");
    expect(free?.containerType).toBeUndefined();
  });

  it("infers calleeType from `self.method()` inside a class method", () => {
    const content =
      "class Service:\n" +
      "    def run(self):\n" +
      "        self.helper()\n" +
      "    def helper(self):\n" +
      "        pass\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const helperCall = parsed.calls.find((c) => c.calleeName === "helper");
    expect(helperCall?.calleeType).toBe("Service");
  });

  it("infers calleeType from class-level annotated field (PEP 526)", () => {
    const content =
      "class App:\n" +
      "    validator: ValidatePassword\n" +
      "    def run(self):\n" +
      "        self.validator.validate()\n";
    const file: SourceFile = { rel: "a.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });

  it("infers calleeType from a typed function parameter", () => {
    const content =
      "def check(v: ValidateEmail):\n" +
      "    v.validate()\n";
    const file: SourceFile = { rel: "c.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidateEmail");
  });

  it("infers calleeType from `x: Foo = ...` annotated local assignment", () => {
    const content =
      "def use():\n" +
      "    v: ValidateUserName = make_validator()\n" +
      "    v.validate()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidateUserName");
  });

  it("infers calleeType from `x = SomeClass()` constructor call", () => {
    // Python class instantiation has no `new` keyword — the type is
    // simply the function being called, when it matches a class.
    const content =
      "def use():\n" +
      "    w = Widget()\n" +
      "    w.render()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const renderCall = parsed.calls.find((c) => c.calleeName === "render");
    expect(renderCall?.calleeType).toBe("Widget");
  });

  it("strips generics in subscript-style hints (List[Foo] → List)", () => {
    // tree-sitter-python parses `List[Foo]` as `generic_type` (not
    // `subscript`); the extractor handles both shapes.
    const content =
      "def use(items: List[Foo]):\n" +
      "    items.append(None)\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const appendCall = parsed.calls.find((c) => c.calleeName === "append");
    expect(appendCall?.calleeType).toBe("List");
  });

  it("untyped Python falls through to undefined calleeType (graceful)", () => {
    const content =
      "def use():\n" +
      "    v = make_thing()\n" + // no annotation, rhs not a class call
      "    v.do_stuff()\n";
    const file: SourceFile = { rel: "u.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const doCall = parsed.calls.find((c) => c.calleeName === "do_stuff");
    // Falls through to "v" as the bare-name guess for receiver type
    expect(doCall).toBeDefined();
  });

  it("two same-named methods on different fields disambiguate", () => {
    const content =
      "class App:\n" +
      "    vp: ValidatePassword\n" +
      "    ve: ValidateEmail\n" +
      "    def run(self):\n" +
      "        self.vp.validate()\n" +
      "        self.ve.validate()\n";
    const file: SourceFile = { rel: "a.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateTypes = parsed.calls
      .filter((c) => c.calleeName === "validate")
      .map((c) => c.calleeType);
    expect(validateTypes).toEqual(["ValidatePassword", "ValidateEmail"]);
  });

  it("captures __init__ self.X = param assignments when param is typed", () => {
    // Common Python pattern: store typed constructor args as instance fields.
    const content =
      "class Service:\n" +
      "    def __init__(self, validator: ValidatePassword):\n" +
      "        self.validator = validator\n" +
      "    def run(self):\n" +
      "        self.validator.validate()\n";
    const file: SourceFile = { rel: "s.py", ext: "py", content };
    const ix = makeIndex([file]);
    const parsed = parseFile(pythonPlugin, file, ix);
    const validateCall = parsed.calls.find(
      (c) => c.calleeName === "validate"
    );
    expect(validateCall?.calleeType).toBe("ValidatePassword");
  });
});

// ---------------- v0.77: Class extraction (Architecture tab) ----------------

describe("pythonPlugin — class extraction for Architecture tab", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  it("emits a ParsedClass for a basic class with PEP-526 fields + methods", () => {
    const content =
      "class User:\n" +
      "    name: str\n" +
      "    age: int\n" +
      "    def __init__(self, name: str):\n" +
      "        self.name = name\n" +
      "    def login(self, password: str):\n" +
      "        pass\n";
    const file: SourceFile = { rel: "user.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    expect(parsed.classes).toHaveLength(1);
    const cls = parsed.classes![0];
    expect(cls.name).toBe("User");
    expect(cls.isInterface).toBe(false);
    expect(cls.isAbstract).toBe(false);
    expect(cls.fields.map((f) => f.name).sort()).toEqual(["age", "name"]);
    expect(cls.methodNames.sort()).toEqual(["__init__", "login"]);
  });

  it("derives field visibility from PEP-8 naming convention", () => {
    // Python has no explicit access modifiers — convention is the
    // only signal: __X = private, _X = protected, X = public.
    // Dunder names (__init__, __X__) are NOT private — they're
    // language hooks and should read as public.
    const content =
      "class V:\n" +
      "    pub: int\n" +
      "    _prot: int\n" +
      "    __priv: int\n";
    const file: SourceFile = { rel: "v.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get("pub")?.visibility).toBe("public");
    expect(byName.get("_prot")?.visibility).toBe("protected");
    expect(byName.get("__priv")?.visibility).toBe("private");
  });

  it("captures parentClass from positional inheritance argument", () => {
    const content =
      "class Animal:\n" +
      "    pass\n" +
      "class Dog(Animal):\n" +
      "    def speak(self):\n" +
      "        return 'woof'\n";
    const file: SourceFile = { rel: "animal.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    const byName = new Map(parsed.classes!.map((c) => [c.name, c]));
    expect(byName.get("Dog")?.parentClass).toBe("Animal");
    expect(byName.get("Animal")?.parentClass).toBeUndefined();
  });

  it("flags ABC / ABCMeta / Protocol parents as isAbstract (not as the parent class)", () => {
    // ABC is a stylistic marker that the class is abstract — treating
    // it as a structural parent in the diagram would clutter the
    // hierarchy. Route it through isAbstract instead.
    const content =
      "from abc import ABC\n" +
      "class Shape(ABC):\n" +
      "    pass\n" +
      "class Drawable(ABC, Logger):\n" +
      "    pass\n";
    const file: SourceFile = { rel: "shapes.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    const byName = new Map(parsed.classes!.map((c) => [c.name, c]));
    expect(byName.get("Shape")?.isAbstract).toBe(true);
    expect(byName.get("Shape")?.parentClass).toBeUndefined();
    // When ABC is mixed with a real parent, ABC is still filtered and
    // the real parent surfaces.
    expect(byName.get("Drawable")?.isAbstract).toBe(true);
    expect(byName.get("Drawable")?.parentClass).toBe("Logger");
  });

  it("captures methods wrapped in decorators (@property, @abstractmethod)", () => {
    // Decorated methods in Python come through as `decorated_definition`
    // wrapping a `function_definition`. We unwrap so they show up in
    // methodNames just like undecorated methods.
    const content =
      "from abc import ABC, abstractmethod\n" +
      "class Service(ABC):\n" +
      "    @abstractmethod\n" +
      "    def run(self):\n" +
      "        pass\n" +
      "    @property\n" +
      "    def name(self) -> str:\n" +
      "        return 'svc'\n" +
      "    def helper(self):\n" +
      "        pass\n";
    const file: SourceFile = { rel: "service.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    expect(parsed.classes![0].methodNames.sort()).toEqual([
      "helper",
      "name",
      "run",
    ]);
  });

  it("isInterface stays false (Python has no native interface concept)", () => {
    // Even classes that look "interface-y" via Protocol or ABC stay
    // classes from our model's perspective. We don't pretend Python
    // has interfaces — they're a Java/C# concept the language doesn't
    // expose.
    const content =
      "from typing import Protocol\n" +
      "class Drawable(Protocol):\n" +
      "    def draw(self) -> None: ...\n";
    const file: SourceFile = { rel: "drawable.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    expect(parsed.classes![0].isInterface).toBe(false);
    // But Protocol IS treated as abstract — same routing as ABC
    expect(parsed.classes![0].isAbstract).toBe(true);
  });

  it("captures bare class-level constants (no PEP-526 annotation)", () => {
    // CLASS_CONST = 42 inside a class body should still surface as a
    // field even without an explicit type annotation.
    const content =
      "class Config:\n" +
      "    VERSION = '1.0'\n" +
      "    timeout: int = 30\n";
    const file: SourceFile = { rel: "config.py", ext: "py", content };
    const parsed = parseFile(pythonPlugin, file, makeIndex([file]));
    const fields = parsed.classes![0].fields;
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.has("VERSION")).toBe(true);
    expect(byName.get("VERSION")?.type).toBeUndefined();
    expect(byName.get("timeout")?.type).toBe("int");
  });
});

// ---------------------------------------------------------------------------
// Route decorators → FunctionDef.entryPoint
//
// Routing is never a call edge, so a decorated handler looks like dead code to
// the graph. These tests pin BOTH directions: real routes are marked, and the
// things that merely look like routes are not. The false-positive cases matter
// more than the positive ones — a wrong entry point invents reachability, and
// reachability is what the security layer suppresses findings with.
// ---------------------------------------------------------------------------
describe("pythonPlugin — route decorators", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  const parse = (content: string) => {
    const file: SourceFile = { rel: "api.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file]));
  };
  const entryOf = (content: string, name: string) =>
    parse(content).functions.find((f) => f.name === name)?.entryPoint;

  it("marks a FastAPI verb decorator with its method and path", () => {
    const ep = entryOf('@app.get("/items")\ndef read_items():\n    return []\n', "read_items");
    expect(ep).toEqual({
      kind: "http-route",
      methods: ["GET"],
      route: "/items",
      via: "@app.get",
    });
  });

  it("reads methods= off a Flask @app.route", () => {
    const ep = entryOf(
      "@app.route('/serialize', methods=['POST', 'put'])\ndef serialize():\n    pass\n",
      "serialize"
    );
    expect(ep?.methods).toEqual(["POST", "PUT"]);
    expect(ep?.route).toBe("/serialize");
  });

  it("leaves methods undefined on a bare @app.route rather than assuming GET", () => {
    // Flask defaults to GET-only, but an INFERRED method is indistinguishable
    // from a declared one downstream. Record silence as silence.
    const ep = entryOf("@app.route('/')\ndef index():\n    pass\n", "index");
    expect(ep?.route).toBe("/");
    expect(ep?.methods).toBeUndefined();
  });

  it("works on any router object, not just one named `app`", () => {
    expect(entryOf('@router.post("/login")\ndef login():\n    pass\n', "login")?.methods).toEqual([
      "POST",
    ]);
    expect(entryOf('@bp.delete("/x")\ndef drop():\n    pass\n', "drop")?.methods).toEqual([
      "DELETE",
    ]);
  });

  it("does NOT mark a cache lookup that happens to be spelled @x.get", () => {
    // The discriminator is the leading "/" on a static first argument. Without
    // it this is indistinguishable from a route, and marking it would invent an
    // entry point that untrusted input never touches.
    expect(entryOf('@cache.get("session-key")\ndef helper():\n    pass\n', "helper")).toBeUndefined();
  });

  it("does NOT mark ordinary decorators", () => {
    const content =
      "@property\ndef name(self):\n    pass\n\n@csrf_exempt\ndef view(request):\n    pass\n";
    expect(entryOf(content, "name")).toBeUndefined();
    expect(entryOf(content, "view")).toBeUndefined();
  });

  it("does NOT mark a route whose path is computed", () => {
    // f-strings and variables resolve at runtime; any path we printed would be
    // a guess, so we decline rather than guess.
    expect(entryOf('@app.get(f"/items/{x}")\ndef fstr():\n    pass\n', "fstr")).toBeUndefined();
    expect(entryOf("@app.get(PATH)\ndef var():\n    pass\n", "var")).toBeUndefined();
  });

  it("gives the marker to the decorated function, not to a function nested in it", () => {
    // The body is walked before the outer function is pushed, so a naive
    // implementation hands the marker to the inner definition.
    const content =
      '@app.get("/outer")\n' +
      "def outer():\n" +
      "    def inner():\n" +
      "        return 1\n" +
      "    return inner()\n";
    expect(entryOf(content, "outer")?.route).toBe("/outer");
    expect(entryOf(content, "inner")).toBeUndefined();
  });

  it("marks decorated methods inside a class", () => {
    const content =
      "class Views:\n" +
      '    @router.get("/me")\n' +
      "    def me(self):\n" +
      "        pass\n";
    expect(entryOf(content, "me")?.route).toBe("/me");
  });

  it("keeps recording the decorator's own call edge", () => {
    // The decorator expression is still visited exactly as before — this pins
    // that adding the marker did not change call extraction.
    const parsed = parse('@app.get("/items")\ndef read_items():\n    pass\n');
    expect(parsed.calls.some((c) => c.calleeName === "get")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Django URLconf rows → ParsedFile.routes
//
// The plugin only READS the table; buildCodeGraph resolves the names (covered
// in codeGraph.test.ts). These tests pin what counts as a row worth recording.
// ---------------------------------------------------------------------------
describe("pythonPlugin — Django URLconf", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  const DJANGO = "from django.urls import include, path\nfrom . import views\n";
  const parseUrls = (content: string, rel = "app/urls.py") => {
    const file: SourceFile = { rel, ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file]));
  };

  it("reads a path() row into a route declaration", () => {
    const parsed = parseUrls(
      DJANGO + "urlpatterns = [\n    path('xss', views.xss, name='xss'),\n]\n"
    );
    expect(parsed.routes).toEqual([
      { route: "xss", targetModule: "views", targetName: "xss", via: "path()" },
    ]);
  });

  it("reads the re_path() and url() spellings too", () => {
    const parsed = parseUrls(
      "from django.conf.urls import url\nfrom django.urls import re_path\nfrom . import views\n" +
        "urlpatterns = [\n" +
        "    re_path(r'^a$', views.a),\n" +
        "    url(r'^b$', views.b),\n" +
        "]\n"
    );
    expect(parsed.routes?.map((r) => r.via).sort()).toEqual(["re_path()", "url()"]);
  });

  it("records a bare handler reference with no module qualifier", () => {
    const parsed = parseUrls(
      "from django.urls import path\nfrom .views import home\nurlpatterns = [path('', home)]\n"
    );
    expect(parsed.routes?.[0]).toMatchObject({ targetModule: null, targetName: "home" });
  });

  it("skips include() — it delegates to another table, it isn't a handler", () => {
    const parsed = parseUrls(
      DJANGO + "urlpatterns = [path('accounts/', include('allauth.urls'))]\n"
    );
    expect(parsed.routes ?? []).toEqual([]);
  });

  it("reads class-based views as a class target, not a function", () => {
    // Was a declared miss in the first URLconf reader; see the class-based
    // views block below for the full behaviour.
    const parsed = parseUrls(
      DJANGO + "urlpatterns = [path('x', views.MyView.as_view())]\n"
    );
    expect(parsed.routes?.[0]).toMatchObject({
      targetName: "MyView",
      targetIsClass: true,
    });
  });

  it("records nothing without a django.urls import, whatever the file is called", () => {
    // `path(...)` and especially `url(...)` are far too common a spelling to
    // claim on sight. The import is the local evidence that this is a URLconf.
    const parsed = parseUrls(
      "from . import views\nurlpatterns = [path('xss', views.xss)]\n"
    );
    expect(parsed.routes ?? []).toEqual([]);
  });

  it("skips a row whose route isn't a static string", () => {
    const parsed = parseUrls(DJANGO + "urlpatterns = [path(PREFIX, views.home)]\n");
    expect(parsed.routes ?? []).toEqual([]);
  });

  it("leaves routes unset for an ordinary Python file", () => {
    const file: SourceFile = { rel: "app/views.py", ext: "py", content: "def home():\n    pass\n" };
    expect(parseFile(pythonPlugin, file, makeIndex([file])).routes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Security sinks.
//
// Paired by design: every rule gets a case that must fire and a neighbouring
// case that must not. The negatives are the point — a sink scanner earns its
// reputation on what it stays quiet about, and reachability RANKS findings, it
// does not rescue bad ones.
// ---------------------------------------------------------------------------
describe("pythonPlugin — security sinks", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  const sinksIn = (content: string) => {
    const file: SourceFile = { rel: "app/views.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ruleIds = (content: string) => sinksIn(content).map((s) => s.ruleId);

  it("flags os.system and os.popen", () => {
    expect(ruleIds("def f(c):\n    os.system(c)\n")).toEqual(["py-os-command"]);
    expect(ruleIds("def f(c):\n    os.popen(c)\n")).toEqual(["py-os-command"]);
  });

  it("does not flag a system() method on something that isn't os", () => {
    expect(ruleIds("def f(self, c):\n    self.system(c)\n")).toEqual([]);
    expect(ruleIds("def f(p, c):\n    parser.system(c)\n")).toEqual([]);
  });

  it("flags subprocess only when shell=True", () => {
    expect(ruleIds("def f(c):\n    subprocess.Popen(c, shell=True)\n")).toEqual([
      "py-subprocess-shell",
    ]);
    // The argv form has no shell to inject into — safe by construction.
    expect(ruleIds("def f(c):\n    subprocess.run(['ls', c])\n")).toEqual([]);
    expect(ruleIds("def f(c):\n    subprocess.run(c, shell=False)\n")).toEqual([]);
  });

  it("flags bare eval/exec but not a method spelled the same", () => {
    expect(ruleIds("def f(s):\n    eval(s)\n")).toEqual(["py-eval"]);
    expect(ruleIds("def f(s):\n    exec(s)\n")).toEqual(["py-exec"]);
    // Somebody's own evaluator. Matching this is how a scanner earns a
    // reputation for noise.
    expect(ruleIds("def f(e, s):\n    engine.eval(s)\n")).toEqual([]);
  });

  it("flags pickle loading", () => {
    expect(ruleIds("def f(b):\n    pickle.loads(b)\n")).toEqual(["py-pickle-load"]);
    expect(ruleIds("def f(b):\n    dill.load(b)\n")).toEqual(["py-pickle-load"]);
    expect(ruleIds("def f(b):\n    json.loads(b)\n")).toEqual([]);
  });

  it("flags yaml.load unless a Safe loader is named", () => {
    expect(ruleIds("def f(s):\n    yaml.load(s)\n")).toEqual(["py-yaml-unsafe-load"]);
    expect(ruleIds("def f(s):\n    yaml.load(s, Loader=yaml.Loader)\n")).toEqual([
      "py-yaml-unsafe-load",
    ]);
    expect(ruleIds("def f(s):\n    yaml.load(s, Loader=yaml.SafeLoader)\n")).toEqual([]);
    expect(ruleIds("def f(s):\n    yaml.safe_load(s)\n")).toEqual([]);
  });

  it("flags TLS verification switched off", () => {
    expect(ruleIds("def f(u):\n    requests.get(u, verify=False)\n")).toEqual([
      "py-tls-verify-disabled",
    ]);
    expect(ruleIds("def f(u):\n    requests.get(u)\n")).toEqual([]);
  });

  it("does not flag hashing at all — see the plan doc's §4g", () => {
    // Dropped after measuring: md5/sha1 was 19 of Zulip's 25 findings and
    // essentially all of it was cache keys and gravatar hashes. The rule was
    // honestly labelled and still drowned the list.
    expect(ruleIds("def f(x):\n    hashlib.md5(x)\n")).toEqual([]);
    expect(ruleIds("def f(x):\n    hashlib.sha1(x)\n")).toEqual([]);
  });

  describe("SQL assembled from parts", () => {
    it("flags an f-string query at the call site", () => {
      expect(ruleIds('def f(c, n):\n    c.execute(f"SELECT * FROM t WHERE n = {n}")\n')).toEqual([
        "py-sql-assembled",
      ]);
    });

    it("does NOT flag a parameterised query", () => {
      // Literal + params tuple is the fix we would tell someone to apply.
      expect(ruleIds('def f(c, n):\n    c.execute("SELECT * FROM t WHERE n = %s", (n,))\n')).toEqual(
        []
      );
      expect(ruleIds('def f(c):\n    c.execute("SELECT 1")\n')).toEqual([]);
    });

    it("flags concatenation and %-formatting", () => {
      expect(ruleIds('def f(c, n):\n    c.execute("SELECT * FROM t WHERE n = \'" + n + "\'")\n')).toEqual(
        ["py-sql-assembled"]
      );
      expect(ruleIds('def f(c, n):\n    c.execute("SELECT * FROM t WHERE n = \'%s\'" % n)\n')).toEqual(
        ["py-sql-assembled"]
      );
      expect(ruleIds('def f(c, n):\n    c.execute("SELECT {}".format(n))\n')).toEqual([
        "py-sql-assembled",
      ]);
    });

    it("follows a query assembled on an earlier line in the same function", () => {
      // pygoat's SQL lab, and the shape almost all real SQL injection takes.
      const src =
        "def sql_lab(request, name):\n" +
        "    q = \"SELECT * FROM login WHERE user='\" + name + \"'\"\n" +
        "    return login.objects.raw(q)\n";
      expect(ruleIds(src)).toEqual(["py-sql-assembled"]);
    });

    it("follows a query built with +=", () => {
      const src =
        "def f(c, n):\n" +
        '    q = "SELECT * FROM t"\n' +
        '    q += n\n' +
        "    c.execute(q)\n";
      expect(ruleIds(src)).toEqual(["py-sql-assembled"]);
    });

    it("does not treat psycopg2's safe composition API as string assembly", () => {
      // Zulip's real code. sql.SQL/Identifier/Literal exist to build dynamic
      // SQL SAFELY — they escape for you. Flagging them was this rule's only
      // reachable high-severity finding on a real production codebase, and it
      // was wrong.
      const src =
        "def f(presence, field):\n" +
        '    query = sql.SQL("UPDATE t")\n' +
        '    query += sql.SQL("SET {f} = {v}").format(f=sql.Identifier(field), v=sql.Literal(1))\n' +
        "    with connection.cursor() as cursor:\n" +
        "        cursor.execute(query)\n";
      expect(ruleIds(src)).toEqual([]);
    });

    it("does not treat appending a constant as assembly", () => {
      const src =
        'def f(c):\n    q = "SELECT * FROM t"\n    q += " WHERE active"\n    c.execute(q)\n';
      expect(ruleIds(src)).toEqual([]);
    });

    it("does not follow a constant local", () => {
      const src = 'def f(c):\n    q = "SELECT 1"\n    c.execute(q)\n';
      expect(ruleIds(src)).toEqual([]);
    });

    it("does not carry assembly across function boundaries", () => {
      // The lookback is same-function only; anything wider is taint analysis
      // and is not claimed here.
      const src =
        'def build(n):\n    q = f"SELECT {n}"\n    return q\n\ndef run(c, q):\n    c.execute(q)\n';
      expect(ruleIds(src)).toEqual([]);
    });

    it("sees through SQLAlchemy's text() wrapper", () => {
      // VAmPI's real SQL injection: db.session.execute(text(user_query)).
      const src =
        "def get_user(username):\n" +
        '    user_query = f"SELECT * FROM users WHERE username = \'{username}\'"\n' +
        "    return db.session.execute(text(user_query))\n";
      expect(ruleIds(src)).toEqual(["py-sql-assembled"]);
    });
  });

  it("records where the sink is, for the reachability pass to use", () => {
    const src = "class Repo:\n    def load(self, b):\n        return pickle.loads(b)\n";
    const [sink] = sinksIn(src);
    expect(sink).toMatchObject({
      ruleId: "py-pickle-load",
      severity: "high",
      line: 3,
      inFunction: "load",
      inContainerType: "Repo",
      snippet: "return pickle.loads(b)",
    });
  });

  it("records a module-scope sink with no enclosing function", () => {
    // It runs at import, so it can never be reached FROM a route — a real
    // distinction, not a gap, so it is recorded rather than dropped.
    const [sink] = sinksIn('import os\nos.system("id")\n');
    expect(sink.inFunction).toBeNull();
  });

  it("leaves sinks unset for a clean file", () => {
    expect(sinksIn("def add(a, b):\n    return a + b\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Class-based views. Large Django codebases are overwhelmingly CBV — NetBox
// has 84 as_view() rows and 139 DRF registrations against zero function views
// in its URLconfs — and every one of them used to be skipped.
// ---------------------------------------------------------------------------
describe("pythonPlugin — class-based views", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  const DJANGO = "from django.urls import include, path\nfrom . import views\n";
  const routesIn = (content: string, rel = "app/urls.py") => {
    const file: SourceFile = { rel, ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).routes ?? [];
  };

  it("reads a module-qualified as_view() row", () => {
    expect(
      routesIn(DJANGO + "urlpatterns = [path('notifications/', views.NotificationsView.as_view())]\n")
    ).toEqual([
      {
        route: "notifications/",
        targetModule: "views",
        targetName: "NotificationsView",
        targetIsClass: true,
        via: "path()",
      },
    ]);
  });

  it("reads a bare as_view() row", () => {
    expect(
      routesIn(
        "from django.urls import path\nfrom .views import HomeView\nurlpatterns = [path('', HomeView.as_view())]\n"
      )[0]
    ).toMatchObject({ targetName: "HomeView", targetModule: null, targetIsClass: true });
  });

  it("reads a DRF router registration", () => {
    expect(
      routesIn("router.register('wireless-lans', views.WirelessLANViewSet)\n", "app/api/urls.py")[0]
    ).toMatchObject({
      route: "wireless-lans",
      targetModule: "views",
      targetName: "WirelessLANViewSet",
      targetIsClass: true,
      via: "router.register()",
    });
  });

  it("requires the ViewSet naming convention before claiming a register() call", () => {
    // `register` is used by signal handlers, plugin registries and admin sites.
    // The DRF convention is the only local evidence for which one this is.
    expect(routesIn("registry.register('thing', views.Handler)\n", "app/setup.py")).toEqual([]);
    expect(routesIn("admin.register('x', SomeAdmin)\n", "app/admin.py")).toEqual([]);
  });

  it("does not read DRF registrations without a static prefix", () => {
    expect(routesIn("router.register(PREFIX, views.SiteViewSet)\n", "app/api/urls.py")).toEqual([]);
  });
});
