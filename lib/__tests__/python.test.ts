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
    // A plain requests.get on a bare parameter is emitted by the plugin as a
    // taint-REQUIRED sink; classifySinks drops it unless a caller is shown to
    // feed it request data. Not a finding at the product level.
    const plain = sinksIn("def f(u):\n    requests.get(u)\n");
    expect(plain.map((x) => x.ruleId)).toEqual(["py-ssrf"]);
    expect(plain[0].requiresTaint).toBe(true);
    expect(plain[0].taint).toBeUndefined();
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

    it("follows a parenthesized assembled query (dvpwa's shape)", () => {
      // RealVuln miss: `q = ("INSERT ..." "VALUES ('%(n)s')" % {...})` — the
      // whole RHS is parenthesized, which the assembly check skipped.
      const src =
        "def create(conn, name):\n" +
        "    q = (\"INSERT INTO t (name) \" \"VALUES ('%(name)s')\" % {'name': name})\n" +
        "    return conn.execute(q)\n";
      expect(ruleIds(src)).toEqual(["py-sql-assembled"]);
    });

    it("follows a concatenated-string query built with +", () => {
      const src =
        'def f(c, n):\n    q = ("SELECT * FROM t WHERE u=\'" + n + "\'")\n    c.execute(q)\n';
      expect(ruleIds(src)).toEqual(["py-sql-assembled"]);
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

  it("flags a template built and rendered at runtime", () => {
    expect(ruleIds('def f(t):\n    render_template_string(f"Hi {t}")\n')).toEqual(["py-ssti"]);
    expect(ruleIds("def f(t):\n    render_template_string(t)\n")).toEqual(["py-ssti"]);
    // A constant template is just a template.
    expect(ruleIds('def f():\n    render_template_string("<h1>Hi</h1>")\n')).toEqual([]);
  });

  it("flags a JWT decoded without signature verification", () => {
    expect(ruleIds('def f(t):\n    jwt.decode(t, verify=False)\n')).toEqual([
      "py-jwt-unverified",
    ]);
    expect(
      ruleIds('def f(t):\n    jwt.decode(t, options={"verify_signature": False})\n')
    ).toEqual(["py-jwt-unverified"]);
    expect(ruleIds('def f(t, k):\n    jwt.decode(t, k, algorithms=["HS256"])\n')).toEqual([]);
  });

  it("flags a debug server, which serves a remote console", () => {
    expect(ruleIds("def main():\n    app.run(debug=True)\n")).toEqual(["py-debug-server"]);
    expect(ruleIds("def main():\n    app.run(host='0.0.0.0')\n")).toEqual([]);
  });

  it("treats marshal like the other deserialisers", () => {
    expect(ruleIds("def f(b):\n    marshal.loads(b)\n")).toEqual(["py-pickle-load"]);
  });

  describe("security misconfiguration", () => {
    it("flags debug mode enabled", () => {
      expect(ruleIds("DEBUG = True\n")).toEqual(["py-debug-enabled"]);
      expect(ruleIds("app.debug = True\n")).toEqual(["py-debug-enabled"]);
    });

    it("does NOT flag debug disabled or read from config", () => {
      expect(ruleIds("DEBUG = False\n")).toEqual([]);
      expect(ruleIds("DEBUG = os.environ.get('DEBUG')\n")).toEqual([]);
    });

    it("flags a wildcard ALLOWED_HOSTS", () => {
      expect(ruleIds("ALLOWED_HOSTS = ['*']\n")).toEqual(["py-wildcard-allowed-hosts"]);
    });

    it("does NOT flag a specific ALLOWED_HOSTS", () => {
      expect(ruleIds("ALLOWED_HOSTS = ['example.com', 'www.example.com']\n")).toEqual([]);
      expect(ruleIds("ALLOWED_HOSTS = []\n")).toEqual([]);
    });

    it("flags template auto-escaping disabled in config", () => {
      // The other half of the template XSS story — the config-level case §4o
      // documented as a miss.
      expect(
        ruleIds("def setup():\n    return Environment(loader=l, autoescape=False)\n")
      ).toEqual(["py-autoescape-disabled"]);
    });

    it("does NOT flag autoescape left on", () => {
      expect(ruleIds("def setup():\n    return Environment(autoescape=True)\n")).toEqual([]);
      expect(ruleIds("def setup():\n    return Environment(loader=l)\n")).toEqual([]);
    });
  });

  describe("path traversal and SSRF (taint-required rules)", () => {
    it("flags open() on a path built from request data", () => {
      const src =
        "def view(request):\n" +
        "    name = request.GET['f']\n" +
        "    return open('./uploads/' + name, 'rb')\n";
      expect(ruleIds(src)).toEqual(["py-path-traversal"]);
    });

    it("follows taint through os.path.join and abspath", () => {
      const src =
        "def view(request):\n" +
        "    p = request.GET['p']\n" +
        "    return open(os.path.join(BASE, p), 'rb')\n";
      expect(ruleIds(src)).toEqual(["py-path-traversal"]);
    });

    it("flags an outbound request to a URL from request data", () => {
      const src =
        "def view(request):\n    return requests.get(request.POST['url'])\n";
      expect(ruleIds(src)).toEqual(["py-ssrf"]);
    });

    it("flags urlopen too", () => {
      expect(
        ruleIds("def v(request):\n    return urlopen(request.GET['u'])\n")
      ).toEqual(["py-ssrf"]);
    });

    it("does NOT flag a hardcoded URL (the corpus trap)", () => {
      expect(ruleIds("def f():\n    return requests.get('https://example.com')\n")).toEqual([]);
    });

    it("does NOT flag a constant path", () => {
      expect(ruleIds('def f():\n    return open("config.yml", "r")\n')).toEqual([]);
    });

    it("does NOT treat a DB session as an HTTP client", () => {
      // session.delete(row) is SQLAlchemy, not an outbound request — measured
      // being flagged as SSRF before `session` was removed from the receivers.
      expect(ruleIds("def f(note):\n    session.delete(note)\n")).toEqual([]);
    });

    it("does NOT fire on a sanitised filename", () => {
      const src =
        "def upload(request):\n" +
        "    name = secure_filename(request.FILES['f'].name)\n" +
        "    return open(name, 'wb')\n";
      expect(ruleIds(src)).toEqual([]);
    });

    it("marks these rules as requiring confirmed taint", () => {
      // A bare parameter is NOT enough for these two — the finding is emitted
      // with requiresTaint so classifySinks drops it unless a caller is shown
      // to feed it. eval/pickle are dangerous in themselves and carry no flag.
      const bareParam = sinksIn("def helper(path):\n    return open(path, 'r')\n");
      expect(bareParam[0]?.requiresTaint).toBe(true);
      expect(bareParam[0]?.taint).toBeUndefined();

      const evalSink = sinksIn("def f(s):\n    return eval(s)\n");
      expect(evalSink[0]?.requiresTaint).toBeUndefined();
    });
  });

  describe("hardcoded secrets", () => {
    it("flags a module-level secret assigned a literal", () => {
      expect(ruleIds("SECRET_KEY = 'lr66%-a!$km5ed@n5ug'\n")).toEqual(["py-hardcoded-secret"]);
      expect(ruleIds('SECRET_COOKIE_KEY = "PYGOAT"\n')).toEqual(["py-hardcoded-secret"]);
    });

    it("flags an attribute assignment (app.secret_key)", () => {
      expect(ruleIds("app.secret_key = 'super secret key'\n")).toEqual(["py-hardcoded-secret"]);
    });

    it("flags a config subscript (app.config['SECRET_KEY'])", () => {
      expect(ruleIds("app.config['SECRET_KEY'] = 'dvga'\n")).toEqual(["py-hardcoded-secret"]);
    });

    it("flags a JWT signed or verified with a literal secret", () => {
      expect(ruleIds("def f(p):\n    return jwt.encode(p, 'csrf_vulneribility')\n")).toEqual([
        "py-hardcoded-secret",
      ]);
      expect(
        ruleIds("def f(c):\n    return jwt.decode(c, 'secret', algorithms=['HS256'])\n")
      ).toEqual(["py-hardcoded-secret"]);
    });

    it("does NOT flag a secret read from the environment — the correct pattern", () => {
      expect(ruleIds("SECRET_KEY = os.environ['SECRET_KEY']\n")).toEqual([]);
      expect(ruleIds("SECRET_KEY = os.environ.get('SECRET_KEY')\n")).toEqual([]);
      expect(ruleIds("app.secret_key = config('SECRET_KEY')\n")).toEqual([]);
    });

    it("does NOT flag a JWT whose key comes from config", () => {
      expect(ruleIds("def f(p):\n    return jwt.encode(p, settings.SECRET_KEY)\n")).toEqual([]);
    });

    // The corpus's own traps. Our 0-of-107 record lives or dies on these.
    it("does NOT flag a benign dict literal (the CONFIG trap)", () => {
      expect(ruleIds("CONFIG = {\n    'app_name': 'Damn Vulnerable Flask Application'\n}\n")).toEqual([]);
    });

    it("does NOT flag a tuple that merely CONTAINS a secret-ish word", () => {
      // reviewer_data = (112, "...", "auth_token") — the word is the VALUE, and
      // the target name is benign. Matching string contents would hit this.
      expect(
        ruleIds('reviewer_data = (112, "reviewer@x.com", "12321", True, "auth_token")\n')
      ).toEqual([]);
    });

    it("does NOT flag a dict of hashed demo passwords (the USER_A7_LAB3 trap)", () => {
      // The dict KEY is "password", but the assignment target is benign. A
      // key-matching rule would fire here; a target-matching rule does not.
      const src =
        'USER_A7_LAB3 = {\n    "User1": {"username": "User1", "password": "491a2800b807"}\n}\n';
      expect(ruleIds(src)).toEqual([]);
    });

    it("does NOT flag an empty or trivial value", () => {
      expect(ruleIds('SECRET_KEY = ""\n')).toEqual([]);
      expect(ruleIds('SECRET_KEY = "  "\n')).toEqual([]);
    });

    it("does not fire on a generic name we deliberately excluded", () => {
      // KEY / USERNAME are too generic to carry a finding alone — a documented
      // recall trade for the trap record.
      expect(ruleIds("USERNAME = 'admin'\n")).toEqual([]);
    });
  });

  describe("reflected XSS in an HTML response", () => {
    it("flags an HttpResponse assembled from request data", () => {
      const src =
        "def view(request):\n" +
        "    return HttpResponse(f\"<p>Hello {request.GET[\'q\']}</p>\")\n";
      expect(ruleIds(src)).toEqual(["py-reflected-xss"]);
    });

    it("flags a Flask make_response built from a route parameter", () => {
      const src =
        '@app.get("/g/<name>")\ndef g(name):\n    return make_response("<h1>" + name + "</h1>")\n';
      expect(ruleIds(src)).toEqual(["py-reflected-xss"]);
    });

    it("does NOT flag a constant HTML response", () => {
      expect(ruleIds('def v(request):\n    return HttpResponse("<p>static</p>")\n')).toEqual([]);
    });

    it("does NOT flag an assembled HTML response with no untrusted input", () => {
      // Taint is required — this builds HTML from a constant, not from input.
      const src =
        'def v(request):\n    title = "Report"\n    return HttpResponse(f"<h1>{title}</h1>")\n';
      expect(ruleIds(src)).toEqual([]);
    });

    it("does NOT flag a non-HTML assembled inline string", () => {
      // f-string with request data but no HTML markup — not reflected XSS.
      expect(
        ruleIds('def v(request):\n    return HttpResponse(f"count={request.GET[\'n\']}")\n')
      ).toEqual([]);
    });
  });

  describe("escaping switched off", () => {
    it("flags markup assembled with an unescaped interpolation", () => {
      expect(
        ruleIds('def f(v):\n    return mark_safe(f"<span>{v}</span>")\n')
      ).toEqual(["py-mark-safe"]);
    });

    it("does NOT flag markup where every interpolation is escaped", () => {
      // The documented safe form. Flagging it teaches people to ignore the rule.
      expect(
        ruleIds('def f(v):\n    return mark_safe(f\'<a href="{escape(v)}">{escape(v)}</a>\')\n')
      ).toEqual([]);
    });

    it("does NOT flag a translated literal", () => {
      // NetBox wraps gettext constants — 32 of its 38 findings before this,
      // none actionable.
      expect(ruleIds('def f():\n    return mark_safe(_("Values must match"))\n')).toEqual([]);
    });

    it("follows a bare variable only when it was assembled in this function", () => {
      const assembled =
        'def f(v):\n    html = f"<b>{v}</b>"\n    return mark_safe(html)\n';
      expect(ruleIds(assembled)).toEqual(["py-mark-safe"]);
      // Handed in from elsewhere — a taint question, not a call-site one.
      expect(ruleIds("def f(html):\n    return mark_safe(html)\n")).toEqual([]);
    });
  });

  describe("intraprocedural taint", () => {
    const taintOf = (content: string) => sinksIn(content)[0]?.taint;

    it("traces request data through a local into a sink", () => {
      // pygoat's SQL lab, three hops: request.POST -> name -> q -> raw(q).
      const src =
        "def sql_lab(request):\n" +
        "    name = request.POST.get('name')\n" +
        "    q = \"SELECT * FROM t WHERE u='\" + name + \"'\"\n" +
        "    return login.objects.raw(q)\n";
      expect(taintOf(src)).toMatchObject({ source: "request.POST", via: "q" });
    });

    it("records the line the value entered, not the line of the sink", () => {
      const src =
        "def f(request):\n" +
        "    v = request.GET['x']\n" +
        "    return eval(v)\n";
      expect(taintOf(src)).toMatchObject({ line: 2 });
      expect(sinksIn(src)[0].line).toBe(3);
    });

    it("carries taint through an f-string", () => {
      const src =
        'def f(request):\n    return mark_safe(f"<b>{request.POST[\'n\']}</b>")\n';
      expect(taintOf(src)?.source).toContain("request.POST");
    });

    it("recognises Flask and DRF request shapes too", () => {
      expect(
        taintOf("def f(request):\n    return eval(request.args.get('x'))\n")?.source
      ).toBe("request.args");
      expect(
        taintOf("def f(request):\n    return eval(request.query_params['x'])\n")?.source
      ).toContain("request.query_params");
    });

    it("sees request data through self in a class-based view", () => {
      const src =
        "class V:\n    def post(self):\n        return eval(self.request.POST['x'])\n";
      expect(sinksIn(src)[0]?.taint?.source).toContain("request.POST");
    });

    it("treats a declared route handler's own parameters as untrusted", () => {
      // FastAPI has no request object — the parameters ARE the input.
      const src =
        '@app.get("/items/{item_id}")\ndef read_item(item_id):\n    return eval(item_id)\n';
      expect(taintOf(src)).toMatchObject({ via: "item_id" });
    });

    it("does not taint self, cls or request themselves", () => {
      const src = '@app.get("/x")\ndef h(request):\n    return eval(request)\n';
      expect(taintOf(src)).toBeUndefined();
    });

    it("stops at a sanitiser", () => {
      expect(
        taintOf("def f(request):\n    return eval(int(request.GET['id']))\n")
      ).toBeUndefined();
      expect(
        taintOf(
          'def f(request):\n    return mark_safe(f"<b>{escape(request.GET[\'n\'])}</b>")\n'
        )
      ).toBeUndefined();
    });

    it("does NOT claim taint across a function boundary", () => {
      // The whole limit of slice 5, pinned so nobody mistakes silence for
      // safety: source in one function, sink in another.
      const src =
        "def view(request):\n" +
        "    return run(request.POST['cmd'])\n" +
        "\ndef run(cmd):\n" +
        "    os.system(cmd)\n";
      const osSink = sinksIn(src).find((x) => x.ruleId === "py-os-command");
      expect(osSink).toBeDefined();
      expect(osSink?.taint).toBeUndefined();
    });

    it("leaves taint unset on findings that are config, not data flow", () => {
      expect(taintOf("def main():\n    app.run(debug=True)\n")).toBeUndefined();
    });
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

describe("pythonPlugin — catastrophic regex (ReDoS)", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const sinksIn = (content: string) => {
    const file: SourceFile = { rel: "re_use.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };

  // The narrowest rule in the whole set: a group that is quantified AND whose
  // body is quantified. That shape backtracks exponentially. Measured 16 TP /
  // 0 FP on RealVuln — it earns its place by never guessing.
  it("flags a nested-quantifier literal passed straight to re.match", () => {
    const s = sinksIn(`import re\ndef f(x):\n    return re.match(r"((a)+)+", x)\n`);
    expect(s.map((r) => r.ruleId)).toEqual(["py-redos"]);
  });

  it("follows a pattern defined as a module constant", () => {
    const s = sinksIn(`import re\nPATTERN = r"(a+)+"\ndef f(x):\n    return re.compile(PATTERN)\n`);
    expect(s.map((r) => r.ruleId)).toEqual(["py-redos"]);
  });

  // ---- the negatives ----
  it("does NOT flag an ordinary regex", () => {
    expect(sinksIn(`import re\ndef f(x):\n    return re.match(r"^[a-z]+$", x)\n`)).toEqual([]);
    expect(sinksIn(`import re\ndef f(x):\n    return re.search(r"\\\\d{3}-\\\\d{4}", x)\n`)).toEqual([]);
  });

  it("does NOT flag a catastrophic string that never reaches re", () => {
    expect(sinksIn(`LABEL = "((a)+)+"\ndef f():\n    return LABEL\n`)).toEqual([]);
  });

  it("does NOT flag a same-named method on something that is not re", () => {
    expect(sinksIn(`def f(db, x):\n    return db.match(r"((a)+)+", x)\n`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The recall-gap rules (§4v). Each one exists because the family was already
// covered but the SHAPE was not. The negatives below are not decoration — each
// is a specific production line that a slightly looser rule fired on.
// ---------------------------------------------------------------------------
describe("pythonPlugin — credential built with a broken hash", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const sinksIn = (content: string) => {
    const file: SourceFile = { rel: "auth.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ids = (c: string) => sinksIn(c).map((s) => s.ruleId);

  it("flags a password hashed with md5", () => {
    expect(ids("import hashlib\ndef f(password):\n    pwd = hashlib.md5(password.encode()).hexdigest()\n")).toContain(
      "py-broken-hash-credential"
    );
  });

  it("flags a reset token derived from the clock", () => {
    expect(
      ids("import hashlib, datetime\ndef f():\n    token = hashlib.sha1(str(datetime.now()).encode()).hexdigest()\n")
    ).toContain("py-broken-hash-credential");
  });

  // ---- the negatives, each one a measured production line ----
  it("stays silent on sha256 — that is what keeps the traps clean", () => {
    expect(ids("import hashlib\ndef f(password):\n    pwd = hashlib.sha256(password).hexdigest()\n")).toEqual([]);
  });

  it("stays silent on a gravatar hash — the slot is not a credential", () => {
    // The exact shape that made the old call-site rule 19/25 noise on Zulip.
    expect(ids("import hashlib\ndef f(email):\n    gravatar_hash = hashlib.md5(email.lower().encode()).hexdigest()\n")).toEqual([]);
  });

  it("stays silent on a stateful hasher with no argument", () => {
    expect(ids("import hashlib\ndef f():\n    token = hashlib.md5().hexdigest()\n")).toEqual([]);
  });
});

describe("pythonPlugin — credential compared to a literal", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const sinksIn = (content: string) => {
    const file: SourceFile = { rel: "login.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ids = (c: string) => sinksIn(c).map((s) => s.ruleId);

  it("flags a login checked against a committed password", () => {
    expect(ids('def login(u, password):\n    if u == "admin" and password == "admin123":\n        return True\n')).toEqual([
      "py-credential-compared-to-literal",
    ]);
  });

  it("reports a two-branch login once, not twice", () => {
    const src =
      'def login(u, password):\n' +
      '    if u == "a" and password == "reaper":\n        return 1\n' +
      '    elif u == "b" and password == "admin_pass":\n        return 2\n';
    expect(ids(src)).toEqual(["py-credential-compared-to-literal"]);
  });

  // ---- the three guards, each measured against a real production line ----
  it("does NOT flag reading config — the operand is a call", () => {
    // zulip/zproject/config.py:44
    expect(ids('import os\ndef f():\n    if os.environ.get("DISABLE_MANDATORY_SECRET_CHECK") == "True":\n        pass\n')).toEqual([]);
  });

  it("does NOT flag an assert — that is a test, not an auth decision", () => {
    // saleor/plugins/admin_email/tests/test_plugin.py:355
    expect(ids('def test_x(plugin):\n    assert plugin.config.password == "secret-password"\n')).toEqual([]);
  });

  it("does NOT flag a comparison against something computed", () => {
    expect(ids('def f(password, salt):\n    if password == f"{salt}-x":\n        pass\n')).toEqual([]);
  });
});

describe("pythonPlugin — HTML returned straight from a view", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const sinksIn = (content: string) => {
    const file: SourceFile = { rel: "views.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ids = (c: string) => sinksIn(c).map((s) => s.ruleId);

  it("flags an inline assembled tag carrying request data", () => {
    expect(
      ids('def search(request):\n    q = request.args.get("q")\n    return f"<h1>Results for {q}</h1>"\n')
    ).toContain("py-reflected-xss");
  });

  it("sees through a parenthesised conditional in the middle of the string", () => {
    expect(
      ids('def f(request):\n    x = request.args.get("x")\n    return "<p>" + (str(x) if x else "") + "</p>"\n')
    ).toContain("py-reflected-xss");
  });

  // ---- the negatives: accepting a bare identifier here fired 47 times
  // across zulip/netbox/saleor. Each of these is one of those shapes. ----
  it("does NOT flag returning a variable that merely holds html", () => {
    expect(ids('def f(request):\n    template = build(request)\n    return template\n')).toEqual([]);
  });

  it("does NOT flag an assembled tag with no untrusted input", () => {
    // netbox/netbox/tables/columns.py:531 shape
    expect(ids('def f(item):\n    return f\'<a href="{item.url}">x</a>\'\n')).toEqual([]);
  });

  it("does NOT flag a parameter — an unknown caller is not evidence", () => {
    expect(ids('def render_row(name):\n    return f"<td>{name}</td>"\n')).toEqual([]);
  });

  it("does NOT flag an environment variable echoed into html", () => {
    expect(ids('import os\ndef health():\n    return f"<h1>Stage: {os.environ[\'STAGE\']}</h1>"\n')).toEqual([]);
  });
});

describe("pythonPlugin — names that only look like secrets", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "models.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("does NOT flag a header name", () => {
    expect(ids('API_KEY_HEADER = "X-API-Key"\n')).toEqual([]);
  });

  it("does NOT flag an enum tag that echoes its own constant name", () => {
    expect(ids("ACTION_API_KEY_CREATED = 'api_key_created'\n")).toEqual([]);
  });

  it("does NOT flag an audit marker", () => {
    expect(ids('changes["password"] = "reset"\n')).toEqual([]);
  });

  // The counter-cases: each of these was lost to a first version of the guards
  // above that reached too far, and each is a real finding.
  it("still flags a secret whose name merely CONTAINS the value", () => {
    expect(ids("app.config['SECRET_KEY_HMAC'] = 'secret'\n")).toEqual(["py-hardcoded-secret"]);
  });

  it("still flags a credential in a *_NAME constant", () => {
    expect(ids('SUPER_SECRET_NAME = "John Ripper"\n')).toEqual(["py-hardcoded-secret"]);
  });
});

// ---------------------------------------------------------------------------
// Engine-level taint and receiver fixes (§4x). None of these is a new rule —
// each one un-blinds every existing rule at once, which is why they are worth
// more than the rules built on top of them.
// ---------------------------------------------------------------------------
describe("pythonPlugin — import aliases and dotted receivers", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "views.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("resolves `import os as _os` back to os", () => {
    // 30 of 30 command injections on realistic apps were exactly this shape.
    expect(ids('import os as _os\ndef v(request):\n    _os.system("ping " + request.GET["h"])\n')).toEqual([
      "py-os-command",
    ]);
  });

  it("resolves an alias imported inside the function", () => {
    expect(ids('def v(request):\n    import os as _os\n    _os.system("ping " + request.GET["h"])\n')).toEqual([
      "py-os-command",
    ]);
  });

  it("drops the alias when the name is rebound anywhere in the file", () => {
    // The one demonstrated false-positive class: `sp` is the module at the top
    // and a local object further down. If we cannot tell them apart, stay quiet.
    expect(
      ids('import subprocess as sp\ndef v(request):\n    sp = Runner()\n    sp.run("x " + request.GET["q"], shell=True)\n')
    ).toEqual([]);
  });

  it("sees a dotted module path as an HTTP client", () => {
    expect(ids('import urllib.request\ndef v(request):\n    urllib.request.urlopen(request.GET["u"])\n')).toEqual([
      "py-ssrf",
    ]);
  });
});

describe("pythonPlugin — taint through await and request methods", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "api.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("carries taint through await", () => {
    // Without this, taint was silently disabled for EVERY rule inside every
    // async FastAPI and aiohttp handler.
    expect(ids("async def v(request):\n    p = await request.json()\n    open(p)\n")).toEqual([
      "py-path-traversal",
    ]);
  });

  it("treats a method called directly on request as a source", () => {
    expect(ids("def v(request):\n    p = request.body()\n    open(p)\n")).toEqual(["py-path-traversal"]);
  });

  it("prefers a request over the environment when a path is joined", () => {
    const src =
      'from pathlib import Path\nimport os\nB = Path(os.environ["D"])\n' +
      'def v(request):\n    t = B / request.GET["n"]\n    open(t)\n';
    const file: SourceFile = { rel: "api.py", ext: "py", content: src };
    const [sink] = parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
    expect(sink.ruleId).toBe("py-path-traversal");
    expect(sink.taint?.source).toContain("request");
  });

  it("still says nothing when nothing untrusted is involved", () => {
    expect(ids("async def v():\n    p = await load_config()\n    open(p)\n")).toEqual([]);
  });
});

describe("pythonPlugin — sinks that judge their receiver", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "ops.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("flags a pathlib write whose PATH came from the request", () => {
    // pathlib puts the path in the receiver and the content in the argument —
    // the opposite of open(path), which is why an argument-only rule was blind.
    expect(
      ids('from pathlib import Path\nB = Path("/exports")\ndef v(request):\n    t = B / request.GET["ref"]\n    t.write_text("x")\n')
    ).toEqual(["py-path-traversal"]);
  });

  it("does NOT flag a pathlib write to a server-chosen path", () => {
    expect(
      ids('from pathlib import Path\nB = Path("/exports")\ndef v():\n    (B / "daily.json").write_text("x")\n')
    ).toEqual([]);
  });

  it("flags a template rendered from assembled untrusted text", () => {
    expect(
      ids('from jinja2 import Template\ndef v(request):\n    f = request.GET["f"]\n    return Template("R: " + f).render()\n')
    ).toEqual(["py-ssti"]);
  });

  it("does NOT flag a constant template", () => {
    expect(ids('from jinja2 import Template\ndef v():\n    return Template("<p>hi</p>").render()\n')).toEqual([]);
  });

  it("does NOT flag a from_string on something that is not a template engine", () => {
    // Saleor writes BaseThumbnailFormat.from_string(...); the name alone is
    // not evidence of a template.
    expect(
      ids('def v(request):\n    return Color.from_string("c" + request.GET["c"]).render()\n')
    ).toEqual([]);
  });
});

describe("pythonPlugin — redirect, XXE, CORS and env-default secrets", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "views.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("flags a redirect to a destination from the request", () => {
    expect(ids('def v(request):\n    return redirect(request.GET["next"])\n')).toEqual(["py-open-redirect"]);
  });

  it("stays silent when the destination is validated in the same function", () => {
    // A deliberate benchmark trap, and the shape NetBox and Django both use.
    const src =
      'def v(request):\n    nxt = request.POST.get("next")\n' +
      "    if nxt and url_has_allowed_host_and_scheme(url=nxt, allowed_hosts={request.get_host()}):\n" +
      "        return redirect(nxt)\n    return redirect('home')\n";
    expect(ids(src)).toEqual([]);
  });

  it("stays silent on a redirect back to the request's own url", () => {
    expect(ids("def v(request):\n    return redirect(request.get_full_path())\n")).toEqual([]);
  });

  it("stays silent when the destination is only parameter-derived", () => {
    // 40 findings on Zulip were this: HttpResponseRedirect(billing_session_url).
    expect(ids("def v(url):\n    return HttpResponseRedirect(url)\n")).toEqual([]);
  });

  it("flags an XML parser told to load external entities", () => {
    expect(ids("from lxml import etree\ndef v():\n    return etree.XMLParser(load_dtd=True)\n")).toEqual(["py-xxe"]);
    expect(ids("from lxml import etree\ndef v():\n    return etree.XMLParser(no_network=False)\n")).toEqual(["py-xxe"]);
  });

  it("does NOT flag a default or hardened XML parser", () => {
    expect(ids("from lxml import etree\ndef v():\n    return etree.XMLParser()\n")).toEqual([]);
    expect(ids("from lxml import etree\ndef v():\n    return etree.XMLParser(load_dtd=False, no_network=True)\n")).toEqual([]);
    // huge_tree is an oversized-document guard, not entity resolution —
    // reporting it as XXE would say something false about the code.
    expect(ids("from lxml import etree\ndef v():\n    return etree.XMLParser(huge_tree=True)\n")).toEqual([]);
  });

  it("flags an Origin reflected straight back", () => {
    expect(
      ids('def v(request, resp):\n    resp["Access-Control-Allow-Origin"] = request.headers["Origin"]\n')
    ).toEqual(["py-cors-origin-reflected"]);
  });

  it("does NOT flag a fixed CORS origin", () => {
    expect(ids('def v(resp):\n    resp["Access-Control-Allow-Origin"] = "https://app.example.com"\n')).toEqual([]);
    expect(ids('def v(resp):\n    resp["Access-Control-Allow-Origin"] = "*"\n')).toEqual([]);
  });

  it("flags a secret shipped as an env-lookup fallback", () => {
    expect(ids('import os\nJWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-value")\n')).toEqual([
      "py-hardcoded-secret",
    ]);
  });

  it("does NOT flag an env lookup with no fallback", () => {
    expect(ids('import os\nJWT_SECRET = os.getenv("JWT_SECRET")\n')).toEqual([]);
    expect(ids('import os\nJWT_SECRET = os.environ["JWT_SECRET"]\n')).toEqual([]);
  });
});

// The two data-flow rules from §4y. A third — mass assignment — was designed,
// implemented and killed: `dict.update(tainted)` proves untrusted data ARRIVES
// somewhere, never that the destination is dangerous, and every seeded case
// merely returned the dict. See §4y.
describe("pythonPlugin — credentials written to a log", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "views.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };
  const log = (expr: string) =>
    ids(`import logging\nlogger = logging.getLogger(__name__)\ndef v(request):\n    logger.warning("x=%s", ${expr})\n`);

  it("flags an Authorization header written straight to the log", () => {
    expect(log('request.headers.get("authorization")')).toEqual(["py-credential-logged"]);
  });

  it("flags it through an f-string", () => {
    expect(
      ids(
        'import logging\nlogger = logging.getLogger(__name__)\ndef v(request):\n' +
          '    logger.info(f"auth={request.headers.get(\'cookie\')}")\n'
      )
    ).toEqual(["py-credential-logged"]);
  });

  // ---- the derivation guard. Each of these is a developer doing it RIGHT,
  // and each one fired before the guard existed. ----
  it("does NOT flag a redacted credential", () => {
    expect(log('redact(request.headers.get("authorization"))')).toEqual([]);
  });

  it("does NOT flag a hash of the credential", () => {
    // The correlation-id idiom — and the same md5-for-gravatar shape that got
    // the original weak-hash rule deleted.
    expect(log('hashlib.sha256(request.headers.get("authorization").encode()).hexdigest()')).toEqual([]);
  });

  it("does NOT flag a boolean, a length or a prefix", () => {
    expect(log('bool(request.headers.get("authorization"))')).toEqual([]);
    expect(log('len(request.headers.get("authorization") or "")')).toEqual([]);
    expect(log('request.headers.get("authorization", "")[:6]')).toEqual([]);
  });

  it("does NOT flag a non-credential header, or a device token", () => {
    expect(log('request.headers.get("user-agent")')).toEqual([]);
    expect(log('payload.get("token")')).toEqual([]);
  });
});

describe("pythonPlugin — secrets from a predictable PRNG", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "auth.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("flags a reset code built character by character from random", () => {
    expect(
      ids('import random\ndef v():\n    code = "".join(random.choice("abc123") for _ in range(24))\n')
    ).toEqual(["py-weak-prng-secret"]);
  });

  // ---- the .join requirement is the whole safety margin ----
  it("does NOT flag a single draw — that is a pick, not a generated secret", () => {
    // `key = random.choice(list(keys))` samples a dict; CPython's own
    // email/generator.py does `token = random.randrange(...)`.
    expect(ids("import random\ndef v(keys):\n    key = random.choice(list(keys))\n")).toEqual([]);
    expect(ids("import random\ndef v(n):\n    partition_key = random.randint(0, n - 1)\n")).toEqual([]);
  });

  it("does NOT flag a non-secret slot", () => {
    expect(
      ids('import random\ndef v():\n    status_code = "".join(random.choice("123") for _ in range(3))\n')
    ).toEqual([]);
  });

  it("does NOT flag a proper CSPRNG", () => {
    expect(ids('import secrets\ndef v():\n    token = "".join(secrets.choice("abc") for _ in range(24))\n')).toEqual([]);
    expect(
      ids('import random\ndef v():\n    r = random.SystemRandom()\n    token = "".join(r.choice("abc") for _ in range(24))\n')
    ).toEqual([]);
  });
});

describe("pythonPlugin — the request is not uniformly untrusted", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const ids = (content: string) => {
    const file: SourceFile = { rel: "views.py", ext: "py", content };
    return (parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? []).map((s) => s.ruleId);
  };

  it("still treats caller-supplied data as untrusted", () => {
    expect(ids('def v(request):\n    return redirect(request.GET["next"])\n')).toEqual(["py-open-redirect"]);
    expect(ids('def v(request):\n    return redirect(request.POST["next"])\n')).toEqual(["py-open-redirect"]);
  });

  // request.user comes from the auth middleware, request.session from a
  // server-side store. Calling them untrusted claims an attacker controls
  // values they cannot reach — found on NetBox, where a redirect to a model's
  // own get_absolute_url() was reported as an open redirect.
  it("does NOT treat framework-populated attributes as untrusted", () => {
    expect(ids("def v(request):\n    return redirect(request.user.profile.url)\n")).toEqual([]);
    expect(ids("def v(request):\n    return redirect(request.session['back'])\n")).toEqual([]);
    expect(ids("def v(request):\n    return redirect(request.resolver_match.url_name)\n")).toEqual([]);
  });

  it("does not confuse a similarly-named attribute", () => {
    // `request.user_input` IS caller data — only whole segments are excluded.
    expect(ids("def v(request):\n    return redirect(request.user_input)\n")).toEqual(["py-open-redirect"]);
  });
});

describe("rebinding a name to an untainted value ends its flow", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  const sinks = (content: string) => {
    const file: SourceFile = { rel: "app/views.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ids = (content: string) => sinks(content).map((s) => s.ruleId).sort();

  // The bug this exists for: secure_filename is in TAINT_SANITIZERS, so the
  // flow IS cut — but taint was only ever added, never removed, so the name
  // stayed tainted and open() below was reported at high severity with a taint
  // trace for a flow that no longer existed. The canonical remediation flagged
  // as the vulnerability.
  it("sanitising in place is not a finding", () => {
    expect(
      ids(
        "from flask import request\n" +
          "from werkzeug.utils import secure_filename\n" +
          "def upload():\n" +
          "    name = request.args['f']\n" +
          "    name = secure_filename(name)\n" +
          "    with open(name) as fh:\n" +
          "        return fh.read()\n"
      )
    ).toEqual([]);
  });

  it("sanitising into a new name is still not a finding", () => {
    // This always worked; pinned so the fix cannot regress it.
    expect(
      ids(
        "from flask import request\n" +
          "from werkzeug.utils import secure_filename\n" +
          "def upload():\n" +
          "    raw = request.args['f']\n" +
          "    safe = secure_filename(raw)\n" +
          "    with open(safe) as fh:\n" +
          "        return fh.read()\n"
      )
    ).toEqual([]);
  });

  it("passing through an unknown helper keeps the flow alive", () => {
    // taintOf propagates through any call it cannot explain, so `t` is truthy
    // and the name is re-marked rather than cleared. This is the true positive
    // the fix must not eat.
    expect(
      ids(
        "from flask import request\n" +
          "def upload():\n" +
          "    name = request.args['f']\n" +
          "    name = my_helper(name)\n" +
          "    with open(name) as fh:\n" +
          "        return fh.read()\n"
      )
    ).toEqual(["py-path-traversal"]);
  });

  it("a CONDITIONAL sanitise does not untaint the code after it", () => {
    // The walk is a plain AST recursion with no control-flow graph, so a
    // rebind inside an if-body is not known to happen. Clearing there would
    // hide a real finding on the else path, so clearing is limited to
    // straight-line code. This test pins that deliberate conservatism —
    // if someone later adds a CFG, this expectation is the thing to revisit.
    expect(
      ids(
        "from flask import request\n" +
          "from werkzeug.utils import secure_filename\n" +
          "def upload(trusted):\n" +
          "    name = request.args['f']\n" +
          "    if trusted:\n" +
          "        name = secure_filename(name)\n" +
          "    with open(name) as fh:\n" +
          "        return fh.read()\n"
      )
    ).toEqual(["py-path-traversal"]);
  });
});

describe("pythonPlugin — import resolution across project layouts", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const resolve = (spec: string, from: string, paths: string[]) => {
    const files: SourceFile[] = paths.map((rel) => ({ rel, ext: "py", content: "" }));
    const ix = makeIndex(files);
    return pythonPlugin.resolveImport?.(spec, from, ix) ?? null;
  };

  it("prefers the real src-layout package over a buried fixture stub", () => {
    // Measured on Flask: `import flask` from a test resolved to
    // tests/test_apps/cliapp/inner1/inner2/flask.py — a five-levels-deep stub —
    // in preference to src/flask/. 38 test imports landed on fixture apps, and
    // because a match was always found nothing reported as unresolved.
    expect(
      resolve("flask", "tests/test_blueprints.py", [
        "tests/test_apps/cliapp/inner1/inner2/flask.py",
        "src/flask/__init__.py",
        "src/flask/blueprints.py",
      ]),
    ).toBe("src/flask/__init__.py");
  });

  it("prefers a shallower module to a deeply nested same-named one", () => {
    expect(
      resolve("config", "app/main.py", [
        "vendor/a/b/c/d/config.py",
        "config.py",
      ]),
    ).toBe("config.py");
  });

  it("still resolves an exact path without consulting the ranking", () => {
    expect(
      resolve("pkg.mod", "app/main.py", ["pkg/mod.py", "other/pkg/mod.py"]),
    ).toBe("pkg/mod.py");
  });

  it("returns null when nothing matches, rather than guessing", () => {
    expect(resolve("nowhere", "app/main.py", ["app/main.py"])).toBeNull();
  });
});

describe("pythonPlugin — re-exported symbols on repeated import lines", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });
  const importsOf = (content: string) => {
    const file: SourceFile = { rel: "src/pkg/__init__.py", ext: "py", content };
    return parseFile(pythonPlugin, file, makeIndex([file])).imports;
  };

  it("merges the names when a package re-exports one per line", () => {
    // Flask's __init__.py is 30 lines of `from .helpers import X as X`. Import
    // edges are deduped by spec — correct, one edge per target — but that was
    // dropping every symbol after the first, so `flask.abort` resolved and
    // `flask.url_for` did not. 88 more calls resolve on Flask with this.
    const imports = importsOf(
      "from .helpers import abort as abort\n" +
        "from .helpers import url_for as url_for\n" +
        "from .helpers import flash as flash\n",
    );
    const helpers = imports.filter((i) => i.rawSpec === ".helpers");
    expect(helpers).toHaveLength(1); // still ONE edge
    expect(helpers[0].symbols).toEqual(["abort", "url_for", "flash"]);
  });

  it("records several names from a single line", () => {
    const [i] = importsOf("from .mod import a, b, c\n");
    expect(i.symbols).toEqual(["a", "b", "c"]);
  });

  it("leaves symbols unset for a plain module import", () => {
    const file: SourceFile = { rel: "app.py", ext: "py", content: "import os\n" };
    const [i] = parseFile(pythonPlugin, file, makeIndex([file])).imports;
    expect(i.symbols).toBeUndefined();
  });
});
