// Python plugin — first migration off the regex-fallback onto a real AST.
//
// Mirrors lib/codeAnalysis/plugins/javascript.ts:
//   - Tree-sitter queries with canonical capture names (@spec / @name /
//     @callee / @body)
//   - resolveImport ports the algorithm from lib/graph.ts:resolvePython so
//     resolution-rate stays at parity with the regex pipeline (we measured
//     99.99% on django/django before the migration)
//
// What this unlocks vs regex-fallback: call-graph at function level, per-
// function cyclomatic complexity, and the Code tab's blast-radius UI now
// works for Python repos the same way it works for JS/TS.

import path from "node:path";
import { Parser } from "web-tree-sitter";
import type { Language, Node as TsNode } from "web-tree-sitter";
import type {
  ClassMemberVisibility,
  CodeAnalysisPlugin,
  EntryPointInfo,
  FileIndex,
  ParsedCall,
  ParsedClass,
  ParsedField,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  PluginQueries,
  RouteDeclaration,
  SinkFinding,
  TaintedArg,
  SinkSeverity,
  TaintEvidence,
  SourceFile,
} from "../types";
import { loadBuiltinGrammar } from "../runtime";
import { hashSubtree } from "../astHash";

const PLUGIN_NAME = "python";
const EXTENSIONS = ["py"] as const;

let lang: Language | null = null;

// ------------------- Tree-sitter queries -------------------

/** Captures a single @spec per import statement. The captured text is the
 *  module path AS WRITTEN — leading dots preserved for relative imports.
 *  resolvePythonImport parses the dot prefix to determine relative depth.
 *
 *    import foo.bar              → spec = "foo.bar"
 *    import foo as f             → spec = "foo"
 *    from foo.bar import x       → spec = "foo.bar"
 *    from .foo import x          → spec = ".foo"
 *    from . import helper        → spec = "."
 *    from ..pkg import x         → spec = "..pkg"
 */
const IMPORTS_QUERY = `
; from X import ... (absolute, X is dotted_name)
(import_from_statement
  module_name: (dotted_name) @spec)

; from .X import ... or from . import ... (relative)
(import_from_statement
  module_name: (relative_import) @spec)

; import X.Y.Z
(import_statement
  name: (dotted_name) @spec)

; import X as Y
(import_statement
  name: (aliased_import name: (dotted_name) @spec))
`;

/** Function and method definitions. Methods are also function_definition
 *  nodes (nested in class_definition), so this covers both. */
const FUNCTION_DEFS_QUERY = `
(function_definition name: (identifier) @name body: (block) @body)
`;

/** Call sites. Two patterns: bare-identifier calls (foo()) and
 *  attribute-access calls (obj.method()) — the latter captures the rightmost
 *  attribute name, matching how the JS plugin handles member_expression. */
const CALL_SITES_QUERY = `
(call function: (identifier) @callee)
(call function: (attribute attribute: (identifier) @callee))
`;

/** McCabe decision points. Notes:
 *  - elif_clause counted in addition to its parent if_statement (each elif
 *    is an additional branch)
 *  - boolean_operator covers both `and` and `or`
 *  - except_clause counted (try_statement itself isn't a branch — it's the
 *    "no exception" path; each except adds a branch)
 *  - case_clause for Python 3.10+ pattern matching
 *  - We deliberately don't count `with_statement` (single-path context
 *    manager) or bare `try_statement` (only its excepts add branches)
 */
const DECISION_POINTS_QUERY = `
(if_statement) @p
(elif_clause) @p
(while_statement) @p
(for_statement) @p
(except_clause) @p
(boolean_operator) @p
(conditional_expression) @p
(case_clause) @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Import resolution -------------------

/** Resolve a Python import spec (as captured by IMPORTS_QUERY) to a repo-rel
 *  file path, or null for external / unresolvable specs.
 *
 *  Algorithm matches lib/graph.ts:resolvePython for parity — porting the
 *  regex pipeline's behavior so resolution rate stays at the level we
 *  measured (django: 99.99%) and we can immediately compare AST output
 *  against the same files.
 *
 *  Steps:
 *   1. Strip leading dots (their count = relative depth + 1; "." = stay,
 *      ".." = up one, "..." = up two, etc.)
 *   2. Split remainder by "." into module-path parts
 *   3. For relative imports, walk up from the importing file's directory
 *   4. Try base.py first, then base/__init__.py
 *   5. Fall back to a fuzzy suffix match — handles repos whose source root
 *      is nested (e.g. src/) so absolute "foo.bar" still resolves to
 *      src/foo/bar.py
 */
function resolvePythonImport(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  // Count leading dots
  let dotCount = 0;
  while (dotCount < spec.length && spec[dotCount] === ".") dotCount++;
  const rest = spec.slice(dotCount);
  const parts = rest.split(".").filter(Boolean);

  // Compute base path
  let base: string;
  if (dotCount > 0) {
    const fromDir = path.posix.dirname(fromPath);
    const up = dotCount - 1; // 1 dot = current dir, 2 = parent, ...
    const fromParts = fromDir.split("/").filter(Boolean);
    if (up > fromParts.length) return null;
    base = fromParts
      .slice(0, fromParts.length - up)
      .concat(parts)
      .join("/");
  } else {
    base = parts.join("/");
  }

  if (!base) return null;

  // Direct file: foo/bar.py
  const direct = `${base}.py`;
  if (ix.byPath.has(direct)) return direct;

  // Package: foo/bar/__init__.py
  const pkg = `${base}/__init__.py`;
  if (ix.byPath.has(pkg)) return pkg;

  // Fuzzy suffix match — handles src/ wrappers and other layout quirks.
  // We check direct first (more specific), then pkg.
  for (const key of ix.byPath.keys()) {
    if (key.endsWith(`/${direct}`)) return key;
  }
  for (const key of ix.byPath.keys()) {
    if (key.endsWith(`/${pkg}`)) return key;
  }

  return null;
}

// ------------------- Type extraction (Python type hints) -------------------
//
// Python type hints are optional. Untyped Python code (the majority before
// type-checking became fashionable) gracefully degrades — the walker leaves
// calleeType undefined and pickCallTarget falls back to name-match.
// Typed Python (modern frameworks like FastAPI / Pydantic) gets the same
// type-aware treatment as TypeScript.

/** Pull the bare class name out of a Python type annotation. Strips
 *  generics (List[Foo] → Foo for our purposes — we want the methods on the
 *  collection type, but List itself rarely has same-named ambiguity, so
 *  we'd actually return List). Returns null for shapes we can't resolve
 *  (Union[A, B], Callable[..., R], string-quoted forward references). */
/** v0.77: map a Python identifier to a visibility level using the
 *  language's PEP-8 naming convention. Python has no explicit access
 *  modifiers — convention is the only signal:
 *    `__name`  → "private" (name-mangled by the interpreter)
 *    `_name`   → "protected" (single underscore = "I'm internal, don't touch")
 *    `name`    → "public"
 *
 *  Edge case: dunder methods like `__init__`, `__str__`, `__repr__`
 *  start with `__` but are NOT private — they're the language's
 *  protocol hooks. We detect the dunder pattern (leading AND trailing
 *  double underscore) and treat them as public. */
function pythonVisibilityFromName(
  name: string
): ClassMemberVisibility {
  if (!name) return "public";
  const isDunder = name.startsWith("__") && name.endsWith("__") && name.length > 4;
  if (isDunder) return "public";
  if (name.startsWith("__")) return "private";
  if (name.startsWith("_")) return "protected";
  return "public";
}

function extractPyTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "type": {
      // `type` wraps the actual type expression — recurse to its first child
      for (const child of node.namedChildren) {
        const t = extractPyTypeName(child);
        if (t) return t;
      }
      return null;
    }
    case "subscript": {
      // Indexing form `arr[0]` — rarely used as a type but handled
      // defensively. The base is in the "value" field.
      const value = node.childForFieldName("value") ?? node.namedChild(0);
      if (value) return extractPyTypeName(value);
      return null;
    }
    case "generic_type": {
      // tree-sitter-python's representation of `List[Foo]`, `Dict[K, V]`,
      // `Optional[Bar]` — the first named child (an identifier) is the
      // base type. Trailing `type_parameter` children hold the type args
      // which we strip.
      for (const child of node.namedChildren) {
        if (child.type === "identifier") return child.text;
        if (child.type === "attribute") return extractPyTypeName(child);
      }
      return null;
    }
    case "attribute": {
      // typing.Optional / pkg.Foo — take the rightmost attribute
      const attr = node.childForFieldName("attribute");
      if (attr?.type === "identifier") return attr.text;
      return null;
    }
    case "string": {
      // Forward references: `'Foo'` or `"Foo"`. Strip quotes, treat as type
      // name if valid identifier-shaped.
      const txt = node.text.replace(/^['"]|['"]$/g, "");
      if (/^[A-Za-z_][\w.]*$/.test(txt)) {
        // pkg.Foo → Foo (last segment)
        const parts = txt.split(".");
        return parts[parts.length - 1] ?? null;
      }
      return null;
    }
    // generic_type, union_type (PEP 604 X | Y), callable types, literal
    // types, etc → null
    default:
      return null;
  }
}

// ------------------- Route decorators (entry-point reader) -------------------
//
// Flask and FastAPI declare HTTP routes as decorators:
//
//   @app.route("/serialize", methods=["POST"])   @router.get("/items/{id}")
//
// Routing is not a call edge, so the graph cannot see these — the decorated
// function typically has zero inbound callers and looks like dead code. Marking
// them is what lets reachability analysis start somewhere real.
//
// DISCRIMINATOR: the first positional argument must be a static string starting
// with "/". That single rule is what separates `@app.get("/items")` from
// `@cache.get("session-key")` — both are `@<ident>.get(...)`, and there is no
// other local evidence to tell them apart. It costs us routes whose path is a
// variable (`@app.route(PATH)`), which is rare and a miss, never a false claim.
//
// Deliberately NOT gated on a flask/fastapi import in the same file: blueprint
// and router modules routinely import only their own `bp` object, so an
// import gate would silently drop exactly the files that hold the routes.

/** Decorator attributes that name an HTTP method directly. */
const HTTP_VERB_DECORATORS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
]);

/** Decorator attributes that declare a route without naming one method.
 *  `route` carries methods in a `methods=` kwarg; `websocket` has no method. */
const ROUTE_DECORATORS = new Set(["route", "api_route", "websocket"]);

/** Literal value of a Python string node, or null when it isn't a plain static
 *  string. f-strings are rejected: their value depends on runtime state, so any
 *  path we printed would be a guess. */
function pyStringLiteral(node: TsNode | null): string | null {
  if (!node || node.type !== "string") return null;
  const raw = node.text;
  const m = /^([A-Za-z]*)("""|'''|"|')([\s\S]*)\2$/.exec(raw);
  if (!m) return null;
  if (/[fF]/.test(m[1])) return null;
  return m[3];
}

/** Read `methods=["GET", "POST"]` off a decorator's argument list. */
function readMethodsKwarg(argList: TsNode): string[] | undefined {
  for (const arg of argList.namedChildren) {
    if (!arg || arg.type !== "keyword_argument") continue;
    if (arg.childForFieldName("name")?.text !== "methods") continue;
    const value = arg.childForFieldName("value");
    if (!value) continue;
    const out: string[] = [];
    for (const item of value.namedChildren) {
      const s = pyStringLiteral(item);
      if (s) out.push(s.toUpperCase());
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

/** Recognise one `(decorator ...)` node as an HTTP route declaration.
 *  Returns null for every decorator that isn't one — @property, @csrf_exempt,
 *  @dataclass and the long tail all fall through here. */
function readRouteDecorator(decorator: TsNode): EntryPointInfo | null {
  // `@x.y(...)` — the decorator's expression must be a call.
  const call = decorator.namedChildren.find((c) => c?.type === "call");
  if (!call) return null;
  const fn = call.childForFieldName("function");
  if (!fn || fn.type !== "attribute") return null;

  const attr = fn.childForFieldName("attribute")?.text;
  if (!attr) return null;
  const isVerb = HTTP_VERB_DECORATORS.has(attr);
  if (!isVerb && !ROUTE_DECORATORS.has(attr)) return null;

  const argList = call.childForFieldName("arguments");
  if (!argList) return null;

  // First POSITIONAL argument, and it has to look like a route path.
  const firstPositional = argList.namedChildren.find(
    (c) => c && c.type !== "keyword_argument"
  );
  const route = pyStringLiteral(firstPositional ?? null);
  if (!route || !route.startsWith("/")) return null;

  const via = `@${fn.text}`;
  if (isVerb) {
    return { kind: "http-route", methods: [attr.toUpperCase()], route, via };
  }
  const methods = readMethodsKwarg(argList);
  return methods
    ? { kind: "http-route", methods, route, via }
    : { kind: "http-route", route, via };
}

// ------------------- Django URLconf (entry-point reader #2) -------------------
//
// Django keeps routing in a table, not on the handler:
//
//   from django.urls import path
//   from . import views
//   urlpatterns = [ path('xss', views.xss, name="xss") ]
//
// So `xss` has no decorator, and `urls.py` REFERENCES it rather than calling
// it — there is no call edge either. To the graph the view is dead code. This
// reader records what the table says; buildCodeGraph resolves the name once
// every file is parsed.
//
// GATE: the file must import django.urls / django.conf.urls. A bare `path(...)`
// or `url(...)` call is far too common a spelling to claim on sight, and the
// import is the one piece of local evidence that says "this is a URLconf".

const DJANGO_URLCONF_IMPORT =
  /^[ \t]*(?:from|import)[ \t]+django\.(?:urls|conf\.urls)\b/m;

/** Django's route-table functions. `url()` is the pre-2.0 spelling, still
 *  everywhere in real repos; `re_path()` is its replacement. */
const URLCONF_FUNCTIONS = new Set(["path", "re_path", "url"]);

/** Read one `path("route", views.handler, ...)` row.
 *
 *  Returns null for the rows that don't name a handler we could ever resolve —
 *  `include("other.urls")` delegates to another table, and
 *  `MyView.as_view()` is a class-based view whose handler is a method we have
 *  no mapping for yet. Both are misses, neither is a wrong answer. */
function readUrlconfRow(call: TsNode, calleeName: string): RouteDeclaration | null {
  if (!URLCONF_FUNCTIONS.has(calleeName)) return null;
  const argList = call.childForFieldName("arguments");
  if (!argList) return null;

  const positional = argList.namedChildren.filter(
    (c): c is TsNode => !!c && c.type !== "keyword_argument"
  );
  const route = pyStringLiteral(positional[0] ?? null);
  if (route === null) return null;

  const target = positional[1];
  if (!target) return null;
  if (target.type === "attribute") {
    // views.home → module "views", name "home"
    const object = target.childForFieldName("object");
    const attribute = target.childForFieldName("attribute");
    if (object?.type !== "identifier" || attribute?.type !== "identifier") return null;
    return {
      route,
      targetModule: object.text,
      targetName: attribute.text,
      via: `${calleeName}()`,
    };
  }
  if (target.type === "identifier") {
    // path("x", home) — imported directly into the urls module.
    return { route, targetModule: null, targetName: target.text, via: `${calleeName}()` };
  }
  if (target.type === "call") {
    // path("x", views.MyView.as_view()) — a class-based view. Large Django
    // codebases are overwhelmingly CBV; measured on NetBox, 84 of its URLconf
    // rows take this form and every one of them was previously skipped.
    return readAsViewTarget(target, `${calleeName}()`, route);
  }
  return null;
}

/** Pull the view class out of `views.MyView.as_view()` or `MyView.as_view()`. */
function readAsViewTarget(
  call: TsNode,
  via: string,
  route: string
): RouteDeclaration | null {
  const fn = call.childForFieldName("function");
  if (fn?.type !== "attribute") return null;
  if (fn.childForFieldName("attribute")?.text !== "as_view") return null;
  const holder = fn.childForFieldName("object");
  if (holder?.type === "attribute") {
    const mod = holder.childForFieldName("object");
    const cls = holder.childForFieldName("attribute");
    if (mod?.type !== "identifier" || cls?.type !== "identifier") return null;
    return {
      route,
      targetModule: mod.text,
      targetName: cls.text,
      targetIsClass: true,
      via,
    };
  }
  if (holder?.type === "identifier") {
    return { route, targetModule: null, targetName: holder.text, targetIsClass: true, via };
  }
  return null;
}

/** DRF viewset registration: `router.register('sites', views.SiteViewSet)`.
 *
 *  A routing table like any other, just spelled as a method call. NetBox has
 *  139 of these against 84 `as_view()` rows, so on a modern Django API this is
 *  the LARGER mechanism.
 *
 *  DISCRIMINATOR: the class name must end in `ViewSet`. `register` is far too
 *  common a method name to claim on sight — signal handlers, plugin registries
 *  and admin sites all use it — and DRF's own naming convention is the one
 *  piece of local evidence that says which `register` this is. Costs us
 *  viewsets named against convention; that is a miss, not a wrong answer. */
function readRouterRegistration(
  call: TsNode,
  fnNode: TsNode,
  calleeName: string
): RouteDeclaration | null {
  if (calleeName !== "register" || fnNode.type !== "attribute") return null;
  const argList = call.childForFieldName("arguments");
  if (!argList) return null;
  const positional = argList.namedChildren.filter(
    (c): c is TsNode => !!c && c.type !== "keyword_argument"
  );
  const route = pyStringLiteral(positional[0] ?? null);
  if (route === null) return null;

  const target = positional[1];
  if (!target) return null;
  if (target.type === "attribute") {
    const mod = target.childForFieldName("object");
    const cls = target.childForFieldName("attribute");
    if (mod?.type !== "identifier" || cls?.type !== "identifier") return null;
    if (!cls.text.endsWith("ViewSet")) return null;
    return {
      route,
      targetModule: mod.text,
      targetName: cls.text,
      targetIsClass: true,
      via: "router.register()",
    };
  }
  if (target.type === "identifier" && target.text.endsWith("ViewSet")) {
    return {
      route,
      targetModule: null,
      targetName: target.text,
      targetIsClass: true,
      via: "router.register()",
    };
  }
  return null;
}

// ------------------- Security sinks -------------------
//
// Dangerous operations, recognised syntactically. A sink is recorded for what
// the code SAYS, never for what it might receive at runtime — whether anything
// can actually reach it is the reachability pass's job, and these two axes are
// kept apart on purpose (see SinkSeverity).
//
// Every rule carries a discriminator tight enough to stand on its own. The
// reachability pass RANKS findings; it does not rescue bad ones. A rule that
// needs "well, it might be reachable" to justify itself does not belong here.
//
// Known misses, all deliberate:
//   - `from os import system` then a bare `system(...)`. Import aliasing needs
//     symbol tracking we don't have; the receiver check is what keeps
//     `self.system()` and `parser.system()` from matching.
//   - `cursor.execute(query)` where `query` was built on an earlier line. That
//     is precisely what intraprocedural taint is for (slice 5). Flagging bare
//     variables today would be a guess dressed as a finding.

/** Extract the value node of a keyword argument, e.g. `shell=True`. */
function kwarg(argList: TsNode, name: string): TsNode | null {
  for (const arg of argList.namedChildren) {
    if (!arg || arg.type !== "keyword_argument") continue;
    if (arg.childForFieldName("name")?.text === name) {
      return arg.childForFieldName("value") ?? null;
    }
  }
  return null;
}

/** First positional (non-keyword) argument. */
function firstPositional(argList: TsNode): TsNode | null {
  return argList.namedChildren.find((c) => c && c.type !== "keyword_argument") ?? null;
}

/** Receiver of an `obj.method()` call, when it is a plain identifier. Returns
 *  null for `self.x.method()` and other compound receivers — a module-level
 *  rule like `os.system` should not match `shim.os.system`. */
function plainReceiver(fnNode: TsNode): string | null {
  const obj = fnNode.childForFieldName("object");
  return obj?.type === "identifier" ? obj.text : null;
}

/** Is this expression a string ASSEMBLED at runtime?
 *
 *  The discriminator for SQL injection. `execute("SELECT 1")` is a constant and
 *  says nothing; `execute(f"... {x}")` is a query built from parts, which is
 *  the shape every SQL-injection finding has. Parameterised queries —
 *  `execute("... %s", (x,))` — are a literal plus a params tuple and correctly
 *  do not match. */
/** A string literal, an f-string, or adjacent string literals ("a" "b"). */
function isStringLike(node: TsNode | null): boolean {
  return node?.type === "string" || node?.type === "concatenated_string";
}

function isAssembledString(node: TsNode | null): boolean {
  if (!node) return false;
  switch (node.type) {
    // Unwrap `(...)` — a query is routinely written
    // `q = ("INSERT ..." "VALUES ('%(x)s')" % {...})`, whose whole RHS is a
    // parenthesized_expression. Not unwrapping it was a measured SQL-recall
    // miss on dvpwa (RealVuln §4p).
    case "parenthesized_expression":
      return isAssembledString(node.namedChildren[0] ?? null);
    case "string":
    case "concatenated_string":
      // An f-string carries `interpolation` children; a plain literal doesn't.
      // Adjacent literals with no interpolation are still constant.
      return node.namedChildren.some((c) => c?.type === "interpolation");
    case "binary_operator": {
      const op = node.childForFieldName("operator")?.text;
      if (op !== "+" && op !== "%") return false;
      // Require a string on one side so arithmetic doesn't match. Accept
      // concatenated_string too — `("A" "B") % x` puts it on the left.
      return (
        isStringLike(node.childForFieldName("left")) ||
        isStringLike(node.childForFieldName("right"))
      );
    }
    case "call": {
      // "...".format(x)
      const fn = node.childForFieldName("function");
      return (
        fn?.type === "attribute" &&
        fn.childForFieldName("attribute")?.text === "format" &&
        isStringLike(fn.childForFieldName("object"))
      );
    }
    default:
      return false;
  }
}

// ------------------- Intraprocedural taint (slice 5) -------------------
//
// "Assembled" says a string was built. "Tainted" says it was built from
// something the outside world controls. Every precision problem left in the
// rule set was that gap: `execute(query)`, `mark_safe(html)` and
// `render_template_string(t)` are all fine until untrusted input reaches them.
//
// SCOPE: one function. A source here and a sink in a callee is interprocedural
// and is NOT claimed. Absence of taint therefore means unproven, never clean —
// which is why taint upgrades a finding's confidence and never removes one.

/** Module-level sources that are untrusted without a request object. */
const TAINT_ROOT_MODULES: Record<string, ReadonlySet<string>> = {
  sys: new Set(["argv", "stdin"]),
  os: new Set(["environ"]),
};

/** The name a parameter node binds.
 *
 *  `typed_parameter` — `def f(x: str)` — carries no `name` field in the
 *  grammar, only an anonymous identifier child. Reading the field returned
 *  null, which silently skipped every annotated parameter and so disabled
 *  interprocedural taint across all typed Python: Zulip recorded parameters
 *  for 1,220 of 21,274 functions. Splats bind a collection rather than a
 *  value and are left alone. */
function parameterName(node: TsNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "default_parameter":
    case "typed_default_parameter":
      return node.childForFieldName("name")?.text ?? null;
    case "typed_parameter": {
      const ident = node.namedChildren.find((c) => c?.type === "identifier");
      return ident?.text ?? null;
    }
    default:
      return null;
  }
}

/** Where a value came from.
 *
 *  `source` is untrusted here and now. `param` is only as untrusted as whatever
 *  the caller passed — undecidable in this file, and exactly the question the
 *  graph pass answers in slice 6. Keeping them apart is what stops the plugin
 *  from claiming a vulnerability it cannot see the other half of. */
type TaintOrigin =
  | { kind: "source"; ev: TaintEvidence }
  | { kind: "param"; name: string; line: number };

/** Calls whose RESULT is untrusted regardless of their arguments. */
const TAINT_SOURCE_CALLS = new Set(["input", "raw_input"]);

/** Functions that render a value harmless. `int(x)` cannot carry an injection;
 *  `escape(x)` cannot carry markup; `shlex.quote(x)` cannot carry a shell
 *  metacharacter. Conservative list — anything not here keeps the taint. */
const TAINT_SANITIZERS = new Set([
  "int",
  "float",
  "bool",
  "len",
  "escape",
  "conditional_escape",
  "escapejs",
  "quote",
  "quote_plus",
  "urlencode",
  "UUID",
]);

/** Escaping helpers whose presence around an interpolation makes it safe. */
const ESCAPE_FUNCTIONS = /\b(escape|conditional_escape|escapejs|urlencode|format_html)\s*\(/;

/** True when an f-string interpolates at least once and EVERY interpolation
 *  runs through an escaping helper. Text-matched on the interpolation subtree
 *  rather than resolved, which is the right precision for a guard whose job is
 *  only to suppress the obviously-correct form. */
function isEveryInterpolationEscaped(node: TsNode): boolean {
  if (node.type !== "string") return false;
  const parts = node.namedChildren.filter((c) => c?.type === "interpolation");
  if (parts.length === 0) return false;
  return parts.every((p) => ESCAPE_FUNCTIONS.test(p!.text));
}

/** Methods that hand a string to a database engine. Matched on the method name
 *  plus an assembled-string argument, not on the receiver — real code calls
 *  these on `cursor`, `conn`, `db`, `session` and half a dozen ORM objects, so
 *  the argument shape carries the precision instead. */
const SQL_EXEC_METHODS = new Set([
  "execute",
  "executemany",
  "executescript",
  "raw",
]);

/** Functions that wrap a query string on its way to the engine. SQLAlchemy's
 *  `text()` is how raw SQL is written in every SQLAlchemy codebase —
 *  `execute(text(q))` — so a rule that only looks at the outer argument sees a
 *  function call and gives up. Unwrapped, then judged on the same terms as any
 *  other query. */
const SQL_WRAPPERS = new Set(["text"]);

/** Look through `text(...)` to the query it carries. */
function unwrapSqlArg(arg: TsNode | null): TsNode | null {
  if (arg?.type !== "call") return arg;
  const wrapper = arg.childForFieldName("function");
  if (wrapper?.type !== "identifier" || !SQL_WRAPPERS.has(wrapper.text)) return arg;
  const inner = arg.childForFieldName("arguments");
  return inner ? firstPositional(inner) : arg;
}

/** subprocess entry points that accept `shell=`. */
const SUBPROCESS_FUNCTIONS = new Set([
  "run",
  "call",
  "check_call",
  "check_output",
  "Popen",
]);

interface SinkRuleHit {
  ruleId: string;
  severity: SinkSeverity;
  /** Set when the rule could show untrusted input reaching this call. */
  taint?: TaintEvidence;
  /** Set when the value reaching this call is a parameter — untrusted only if
   *  a caller makes it so, which the graph pass decides. */
  taintedByParam?: string;
}

/** Match one call node against the sink rules. Returns null for the
 *  overwhelming majority of calls. */
function matchSinkRule(
  call: TsNode,
  fnNode: TsNode,
  calleeName: string,
  /** Was this local name assigned a string built from parts, earlier in the
   *  same function? See the bounded-lookback note on the SQL rule. */
  isAssembledVar: (name: string) => boolean,
  /** Where does this expression's value come from? Slice 5/6. */
  taintOf: (node: TsNode | null) => TaintOrigin | null
): SinkRuleHit | null {
  const argList = call.childForFieldName("arguments");
  const bare = fnNode.type === "identifier";
  const recv = bare ? null : plainReceiver(fnNode);

  // Code execution: bare eval()/exec() only. `obj.eval()` is somebody's own
  // method and matching it is how a scanner earns its reputation for noise.
  if (bare && (calleeName === "eval" || calleeName === "exec")) {
    const args = call.childForFieldName("arguments");
    const o = args ? taintOf(firstPositional(args)) : null;
    const fields =
      o === null ? {} : o.kind === "source" ? { taint: o.ev } : { taintedByParam: o.name };
    return { ruleId: `py-${calleeName}`, severity: "high", ...fields };
  }

  if (!argList) return null;
  /** Split an origin into the two fields a finding carries: proven taint, or
   *  the parameter the graph pass has to decide about. */
  const originFields = (o: TaintOrigin | null) =>
    o === null
      ? {}
      : o.kind === "source"
        ? { taint: o.ev }
        : { taintedByParam: o.name };
  const argTaint = () => originFields(taintOf(firstPositional(argList)));

  // Command execution.
  if (recv === "os" && (calleeName === "system" || calleeName === "popen")) {
    return { ruleId: "py-os-command", severity: "high", ...argTaint() };
  }
  if (recv === "subprocess" && SUBPROCESS_FUNCTIONS.has(calleeName)) {
    // Without shell=True the argv form is safe by construction — no shell to
    // inject into — so the kwarg IS the finding.
    const shell = kwarg(argList, "shell");
    if (shell?.text === "True") {
      return { ruleId: "py-subprocess-shell", severity: "high", ...argTaint() };
    }
    return null;
  }

  // Deserialisation.
  if (
    (recv === "pickle" ||
      recv === "cPickle" ||
      recv === "dill" ||
      recv === "marshal") &&
    (calleeName === "load" || calleeName === "loads")
  ) {
    return { ruleId: "py-pickle-load", severity: "high", ...argTaint() };
  }
  if (recv === "yaml" && (calleeName === "load" || calleeName === "load_all")) {
    // yaml.load with a Safe loader is the documented safe form.
    const loader = kwarg(argList, "Loader");
    if (loader && /Safe/.test(loader.text)) return null;
    return { ruleId: "py-yaml-unsafe-load", severity: "high", ...argTaint() };
  }

  // SQL built by string assembly.
  //
  // BOUNDED LOOKBACK, not taint. Real code almost never assembles the query
  // inside the call — pygoat's SQL-injection lab is the normal shape:
  //
  //   sql_query = "SELECT * FROM login WHERE user='" + name + "'"
  //   val = login.objects.raw(sql_query)
  //
  // so a call-site-only rule fires on almost no real SQL injection. We
  // therefore accept a bare local that was assigned an assembled string
  // earlier in the SAME function. That is a syntactic local-variable lookup,
  // and it is worth being precise about what it does NOT do: it says nothing
  // about whether the assembled parts are untrusted. "Assembled" is not
  // "tainted" — establishing that is slice 5's job, and until then this rule
  // claims exactly what it can see, which is that the query was built rather
  // than written.
  if (!bare && SQL_EXEC_METHODS.has(calleeName)) {
    const arg = unwrapSqlArg(firstPositional(argList));
    const assembled =
      isAssembledString(arg) ||
      (arg?.type === "identifier" && isAssembledVar(arg.text));
    return assembled
      ? { ruleId: "py-sql-assembled", severity: "high", ...originFields(taintOf(arg)) }
      : null;
  }

  // Server-side template injection. A template built at runtime is compiled
  // AND executed, so it is `eval` wearing a web framework's clothes. A literal
  // template is just a template, hence the assembled-argument requirement.
  if (bare && calleeName === "render_template_string") {
    const arg = firstPositional(argList);
    if (isAssembledString(arg) || arg?.type === "identifier") {
      return { ruleId: "py-ssti", severity: "high", ...argTaint() };
    }
    return null;
  }

  // Escaping switched off, on markup ASSEMBLED at runtime.
  //
  // "not a string literal" was too loose: NetBox wraps translated literals —
  // `mark_safe(_("Values must match <code>{regex}</code>"))` — and that is a
  // developer-authored constant passing through gettext, which produced 32 of
  // its 38 findings and none of them actionable. Requiring the same dynamism
  // discriminator the other rules use keeps
  // `mark_safe('<img src="{url}">'.format(...))` and drops the translations.
  if (bare && (calleeName === "mark_safe" || calleeName === "Markup")) {
    const arg = firstPositional(argList);
    // Every interpolation escaped is the documented safe form —
    // `mark_safe(f'<a href="{escape(v)}">{escape(v)}</a>')` is markup the
    // developer assembled and escaped on purpose. Flagging it teaches people
    // to ignore the rule.
    if (arg && isEveryInterpolationEscaped(arg)) return null;
    // Same bounded lookback the SQL rule uses: a bare `mark_safe(html)` counts
    // only when `html` was assembled in this function. Markup handed in from
    // elsewhere is a taint question, and NetBox's table-rendering code is full
    // of it — 31 findings there, none of them answerable from this call site.
    const assembled =
      isAssembledString(arg) ||
      (arg?.type === "identifier" && isAssembledVar(arg.text));
    return assembled
      ? { ruleId: "py-mark-safe", severity: "medium", ...originFields(taintOf(arg)) }
      : null;
  }

  // A JWT decoded without checking its signature is an attacker-authored JWT.
  if (recv === "jwt" && calleeName === "decode") {
    const options = kwarg(argList, "options");
    if (
      kwarg(argList, "verify")?.text === "False" ||
      (options && /verify_signature["']?\s*:\s*False/.test(options.text))
    ) {
      return { ruleId: "py-jwt-unverified", severity: "high" };
    }
    return null;
  }

  // Debug mode serves a remote-code-execution console (Werkzeug) and full
  // tracebacks. Only a finding on the server-start call, never on a config
  // constant we cannot tie to a running app.
  if (calleeName === "run" && kwarg(argList, "debug")?.text === "True") {
    return { ruleId: "py-debug-server", severity: "medium" };
  }

  // Reflected XSS: an HTML response body assembled from untrusted input.
  //
  // Django's HttpResponse and Flask's Response/make_response both default to a
  // text/html content type, so a response built by string assembly from
  // request data — `HttpResponse(f"<p>{request.GET['q']}</p>")` — is reflected
  // XSS. This is the biggest single in-scope recall gap the RealVuln pass found
  // (reflected_xss, §4p): the XSS is in Python that BUILDS html, not only in
  // templates.
  //
  // TAINT IS REQUIRED, not optional. "An assembled HTML response" alone is far
  // too broad — half the views in a framework build HTML. Requiring that the
  // value provably carries untrusted input is what keeps this precise; without
  // taint it does not fire.
  if (bare && HTML_RESPONSE_CALLS.has(calleeName)) {
    const arg = firstPositional(argList);
    const built =
      isAssembledString(arg) ||
      (arg?.type === "identifier" && isAssembledVar(arg.text));
    if (built && arg && isHtmlLike(arg)) {
      const t = taintOf(arg);
      if (t) return { ruleId: "py-reflected-xss", severity: "medium", taint: t.kind === "source" ? t.ev : undefined, taintedByParam: t.kind === "param" ? t.name : undefined };
    }
    return null;
  }

  // Transport security switched off.
  if (kwarg(argList, "verify")?.text === "False" && recv !== null) {
    return { ruleId: "py-tls-verify-disabled", severity: "medium" };
  }

  return null;
}

/** Response constructors whose body defaults to a text/html content type, so
 *  an assembled+tainted argument is reflected into the browser as markup. */
const HTML_RESPONSE_CALLS = new Set([
  "HttpResponse",
  "HttpResponseBadRequest",
  "HttpResponseServerError",
  "HttpResponseNotFound",
  "HttpResponseForbidden",
  "Response",
  "make_response",
]);

/** Does this expression's text look like it carries HTML markup? A cheap tag
 *  check on the assembled literal — the precision guard that separates
 *  `HttpResponse(f"<p>{x}</p>")` from `HttpResponse(user_json)`. For a bare
 *  assembled var we cannot see the literal, so we accept it (taint still
 *  gates), but for an inline assembled string we require a tag. */
function isHtmlLike(node: TsNode): boolean {
  if (node.type === "identifier") return true; // literal not visible; taint gates
  return /<\/?[a-zA-Z]/.test(node.text) || /&lt;|<[a-zA-Z]/.test(node.text);
}

/** Cap per file so a generated or pathological file can't flood the panel. */
const MAX_SINKS_PER_FILE = 100;

// ------------------- parseDirect: AST walk with type tracking -------------------

interface PyClassScope {
  name: string;
  /** Field name → type. Built from class-body assignments with annotations:
   *    class Service:
   *      validator: ValidatePassword
   *  Plus __init__ params with annotations that get assigned to self. */
  fields: Map<string, string>;
}

interface PyMethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
  /** True for class methods — drives self.method() / cls.method() resolution. */
  isInClassMethod: boolean;
  /** Local names assigned a string built from parts, for the SQL rule. See
   *  isAssembledString and the note on bounded lookback in matchSinkRule. */
  assembled: Set<string>;
  /** Locals holding a value derived from untrusted input, with the evidence. */
  tainted: Map<string, TaintOrigin>;
}

function parsePyDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  if (!lang) {
    throw new Error("python plugin not loaded — call plugin.load() first");
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(file.content);
  if (!tree) {
    parser.delete();
    return errorParsedFile(file);
  }

  const imports: ParsedImport[] = [];
  const functions: ParsedFunction[] = [];
  const calls: ParsedCall[] = [];
  /** v0.77: full ParsedClass entries for the Architecture-tab Mermaid
   *  + ReactFlow class canvas. Only emitted for class_definition
   *  nodes; module-level functions and free-standing assignments
   *  don't produce class entries. */
  const parsedClasses: ParsedClass[] = [];
  let totalDecisionPoints = 0;

  const seenImportSpecs = new Set<string>();
  const classStack: PyClassScope[] = [];
  const methodStack: PyMethodScope[] = [];
  /** Route decorator seen on the definition we are about to descend into.
   *  Consumed by the `function_definition` case on ENTRY (not on push) so a
   *  decorated inner function can't steal its enclosing function's marker. */
  let pendingEntryPoint: EntryPointInfo | null = null;
  /** Rows read out of a Django URLconf table, if this file is one. */
  const routes: RouteDeclaration[] = [];
  const isUrlconf = DJANGO_URLCONF_IMPORT.test(file.content);
  const sinks: SinkFinding[] = [];
  /** Module-scope counterpart of PyMethodScope.assembled. */
  const moduleAssembled = new Set<string>();
  /** Sticky by design: if ANY assignment in the function builds the string from
   *  parts, the query can be assembled, so a later `q = "SELECT 1"` does not
   *  clear it. Sticky over last-write-wins because branches
   *  (`if c: q = f"..." else: q = "..."`) would otherwise resolve on walk order,
   *  which is arbitrary. Costs the odd extra finding a human glances at; the
   *  alternative silently drops real ones. */
  const markAssembled = (name: string) => {
    (currentMethod()?.assembled ?? moduleAssembled).add(name);
  };
  const moduleTainted = new Map<string, TaintOrigin>();
  const markTainted = (name: string, origin: TaintOrigin) => {
    (currentMethod()?.tainted ?? moduleTainted).set(name, origin);
  };
  const taintedVar = (name: string): TaintOrigin | null => {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const hit = methodStack[i].tainted.get(name);
      if (hit) return hit;
    }
    return moduleTainted.get(name) ?? null;
  };

  /** Does this expression carry untrusted input? Recursive, and deliberately
   *  conservative: anything it cannot explain returns null, so a sink without
   *  taint is UNPROVEN rather than declared safe. */
  const taintOf = (node: TsNode | null): TaintOrigin | null => {
    if (!node) return null;
    const here = () => node.startPosition.row + 1;
    switch (node.type) {
      case "identifier":
        return taintedVar(node.text);

      case "attribute":
      case "subscript": {
        // Django, Flask and DRF all name the parameter `request`, and that
        // convention is strong enough to key on: `request.POST`,
        // `request.args`, `request.json`, `request.query_params` are all
        // untrusted. Matched as a whole path segment, so `self.request.args`
        // in a class-based view qualifies and `myrequest.x` does not.
        if (/(^|\.)request\.[A-Za-z_]/.test(node.text)) {
          return { kind: "source", ev: { source: node.text.split("(")[0], line: here() } };
        }
        const base =
          node.childForFieldName("object") ?? node.childForFieldName("value");
        if (base?.type === "identifier") {
          const attr = node.childForFieldName("attribute")?.text;
          if (attr && TAINT_ROOT_MODULES[base.text]?.has(attr)) {
            return { kind: "source", ev: { source: `${base.text}.${attr}`, line: here() } };
          }
        }
        // Indexing or reading an attribute off tainted data stays tainted.
        return taintOf(base ?? null);
      }

      case "call": {
        const fn = node.childForFieldName("function");
        const name =
          fn?.type === "identifier"
            ? fn.text
            : fn?.childForFieldName("attribute")?.text;
        // A sanitiser ENDS the flow — that is the whole point of calling one.
        if (name && TAINT_SANITIZERS.has(name)) return null;
        if (fn?.type === "identifier" && TAINT_SOURCE_CALLS.has(fn.text)) {
          return { kind: "source", ev: { source: `${fn.text}()`, line: here() } };
        }
        // `request.POST.get("name")` — the receiver is the source. Also covers
        // string methods on tainted values: `value.strip()` stays tainted.
        const viaReceiver = taintOf(fn?.childForFieldName("object") ?? null);
        if (viaReceiver) return viaReceiver;
        for (const arg of node.childForFieldName("arguments")?.namedChildren ?? []) {
          const t = taintOf(arg ?? null);
          if (t) return t;
        }
        return null;
      }

      case "string": {
        // f-string: any tainted interpolation taints the result.
        for (const part of node.namedChildren) {
          if (part?.type !== "interpolation") continue;
          const t = taintOf(part.namedChildren[0] ?? null);
          if (t) return t;
        }
        return null;
      }

      case "binary_operator":
        return (
          taintOf(node.childForFieldName("left")) ??
          taintOf(node.childForFieldName("right"))
        );

      default:
        return null;
    }
  };

  const isAssembledVar = (name: string): boolean => {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      if (methodStack[i].assembled.has(name)) return true;
    }
    return moduleAssembled.has(name);
  };
  /** Line starts, computed once, so a snippet lookup isn't an O(n) rescan. */
  let lineStarts: number[] | null = null;
  const snippetAt = (row: number): string => {
    if (!lineStarts) {
      lineStarts = [0];
      for (let i = 0; i < file.content.length; i++) {
        if (file.content[i] === "\n") lineStarts.push(i + 1);
      }
    }
    const start = lineStarts[row] ?? 0;
    let end = file.content.indexOf("\n", start);
    if (end < 0) end = file.content.length;
    const text = file.content.slice(start, end).trim();
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  };

  function currentClass(): PyClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): PyMethodScope | null {
    return methodStack[methodStack.length - 1] ?? null;
  }

  function lookupVariableType(name: string): string | null {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    const cls = currentClass();
    if (cls) {
      const t = cls.fields.get(name);
      if (t) return t;
    }
    return null;
  }

  function countDecisionPoint() {
    totalDecisionPoints++;
    const m = currentMethod();
    if (m) m.decisionPoints++;
  }

  /** v0.77: rich field metadata for the Architecture-tab Mermaid +
   *  ReactFlow class canvas. Walks PEP-526-annotated class attributes
   *  AND bare class-level assignments (the `CLASS_CONST = 42` pattern,
   *  which lacks a type annotation but should still surface in the
   *  diagram as a field).
   *
   *  Visibility from PEP-8 naming convention; see
   *  pythonVisibilityFromName for the mapping. isStatic and isReadonly
   *  stay false — Python has neither concept at the language level
   *  (classmethods exist but are rare on data attributes; readonly
   *  needs decorators or property-setter machinery to enforce). */
  function collectFullPythonFields(classBody: TsNode): ParsedField[] {
    const out: ParsedField[] = [];
    function visitStmt(stmt: TsNode) {
      // Class bodies appear as a `block` containing
      // `expression_statement` children, each wrapping an assignment.
      if (
        stmt.type === "expression_statement" &&
        stmt.namedChildren.length === 1 &&
        stmt.namedChildren[0]
      ) {
        const inner = stmt.namedChildren[0];
        if (inner.type === "assignment") {
          const left = inner.childForFieldName("left");
          const typeNode = inner.childForFieldName("type");
          if (left?.type === "identifier") {
            const name = left.text;
            const type = typeNode
              ? extractPyTypeName(typeNode) ?? undefined
              : undefined;
            out.push({
              name,
              type,
              visibility: pythonVisibilityFromName(name),
              isStatic: false,
              isReadonly: false,
            });
          }
        }
      } else if (stmt.type === "assignment") {
        const left = stmt.childForFieldName("left");
        const typeNode = stmt.childForFieldName("type");
        if (left?.type === "identifier") {
          const name = left.text;
          const type = typeNode
            ? extractPyTypeName(typeNode) ?? undefined
            : undefined;
          out.push({
            name,
            type,
            visibility: pythonVisibilityFromName(name),
            isStatic: false,
            isReadonly: false,
          });
        }
      }
    }
    for (const child of classBody.namedChildren) {
      if (child.type === "block") {
        for (const stmt of child.namedChildren) visitStmt(stmt);
      } else {
        visitStmt(child);
      }
    }
    return out;
  }

  /** v0.77: extract the parent class and (skipped) implements list.
   *  Python single-class-with-multiple-bases is the common case;
   *  multi-inheritance MRO chains are rare in real codebases and
   *  hard to render meaningfully on a class diagram. We pick the
   *  FIRST argument as parentClass. ABC / ABCMeta are filtered out
   *  of the parent slot — they're stylistic markers (the class is
   *  "abstract"), not a typical class-hierarchy parent — and routed
   *  through isAbstract instead. */
  function extractPythonParents(
    classNode: TsNode
  ): { parentClass?: string; baseClasses: string[]; isAbstract: boolean } {
    const args = classNode.namedChildren.find(
      (c) => c.type === "argument_list"
    );
    if (!args) return { baseClasses: [], isAbstract: false };
    const names: string[] = [];
    for (const arg of args.namedChildren) {
      if (arg.type === "identifier") names.push(arg.text);
      else if (arg.type === "attribute") {
        // `abc.ABC` form — take the rightmost segment
        const last = arg.text.split(".").pop();
        if (last) names.push(last);
      }
    }
    const isAbstract = names.some(
      (n) => n === "ABC" || n === "ABCMeta" || n === "Protocol"
    );
    const realParents = names.filter(
      (n) => n !== "ABC" && n !== "ABCMeta" && n !== "Protocol"
    );
    return {
      // First base stays the "primary" one so class diagrams are unchanged.
      parentClass: realParents[0],
      // ...and the full list, because Python mixins routinely come first and
      // anything following only the head walks straight past the real base.
      baseClasses: realParents,
      isAbstract,
    };
  }

  /** Walk a class body for `name: Type` annotated attributes (PEP 526),
   *  including `name: Type = default` forms. */
  function collectClassFields(classBody: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    for (const child of classBody.namedChildren) {
      // Class body block — recurse one level
      if (child.type === "block") {
        for (const stmt of child.namedChildren) collectFromStmt(stmt, out);
      } else {
        collectFromStmt(child, out);
      }
    }
    return out;
  }

  function collectFromStmt(stmt: TsNode, out: Map<string, string>) {
    if (
      stmt.type === "expression_statement" &&
      stmt.namedChildren.length === 1
    ) {
      const inner = stmt.namedChildren[0];
      if (inner) {
        if (inner.type === "assignment") {
          // PEP 526: `name: Type = default` is parsed as `assignment` with a
          // type field.
          const left = inner.childForFieldName("left");
          const typeNode = inner.childForFieldName("type");
          if (left?.type === "identifier" && typeNode) {
            const typeName = extractPyTypeName(typeNode);
            if (typeName) out.set(left.text, typeName);
          }
        } else if (inner.type === "typed_default_parameter") {
          // shouldn't appear in class body, but handle defensively
        }
      }
    } else if (stmt.type === "assignment") {
      const left = stmt.childForFieldName("left");
      const typeNode = stmt.childForFieldName("type");
      if (left?.type === "identifier" && typeNode) {
        const typeName = extractPyTypeName(typeNode);
        if (typeName) out.set(left.text, typeName);
      }
    }
  }

  /** Walk an `__init__` body for `self.x = value` patterns, optionally with
   *  annotation `self.x: Foo = value`. The latter is rare; most Python uses
   *  bare `self.x = value` and relies on a class-level annotation for x.
   *  We focus on registering x even from bare assignments WHEN the rhs is a
   *  call/new whose return type we can infer. v1 doesn't infer so we skip. */
  function collectInitSelfAssignments(
    initBody: TsNode,
    paramTypes: Map<string, string>,
    fields: Map<string, string>
  ): void {
    function visitInit(node: TsNode) {
      if (
        node.type === "assignment" ||
        node.type === "expression_statement"
      ) {
        const target =
          node.type === "assignment"
            ? node.childForFieldName("left")
            : node.namedChildren[0]?.childForFieldName?.("left");
        const typeNode =
          node.type === "assignment"
            ? node.childForFieldName("type")
            : node.namedChildren[0]?.childForFieldName?.("type");
        const valueNode =
          node.type === "assignment"
            ? node.childForFieldName("right")
            : node.namedChildren[0]?.childForFieldName?.("right");

        // Detect self.X = ... patterns
        if (
          target?.type === "attribute" &&
          target.childForFieldName("object")?.type === "identifier" &&
          target.childForFieldName("object")?.text === "self"
        ) {
          const attrNode = target.childForFieldName("attribute");
          if (attrNode?.type === "identifier") {
            const fieldName = attrNode.text;
            // Annotation form: self.x: Foo = ...
            if (typeNode) {
              const typeName = extractPyTypeName(typeNode);
              if (typeName) fields.set(fieldName, typeName);
            } else if (valueNode?.type === "identifier") {
              // self.x = paramName — copy the param's type
              const paramType = paramTypes.get(valueNode.text);
              if (paramType) fields.set(fieldName, paramType);
            }
          }
        }
      }
      for (const child of node.namedChildren) visitInit(child);
    }
    visitInit(initBody);
  }

  /** Pull (paramName, typeName?) from a parameter node. Python has several
   *  parameter shapes — typed_default_parameter (with default + type),
   *  typed_parameter (with type, no default), default_parameter (default,
   *  no type), and bare identifier (no type, no default). */
  function extractPythonParam(
    paramNode: TsNode
  ): { name: string; type: string | null } | null {
    switch (paramNode.type) {
      case "identifier":
        return { name: paramNode.text, type: null };
      case "typed_parameter":
      case "typed_default_parameter": {
        // typed_parameter: name (identifier), type (type)
        const nameNode =
          paramNode.namedChildren.find((c) => c.type === "identifier") ??
          null;
        const typeNode = paramNode.childForFieldName("type");
        if (!nameNode) return null;
        const typeName = typeNode ? extractPyTypeName(typeNode) : null;
        return { name: nameNode.text, type: typeName };
      }
      case "default_parameter": {
        const nameNode = paramNode.childForFieldName("name");
        if (nameNode?.type === "identifier") {
          return { name: nameNode.text, type: null };
        }
        return null;
      }
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        // *args / **kwargs — skip
        return null;
      default:
        return null;
    }
  }

  function collectMethodParams(
    funcDef: TsNode,
    isInClass: boolean
  ): Map<string, string> {
    const out = new Map<string, string>();
    const params = funcDef.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractPythonParam(p);
      if (info && info.type) out.set(info.name, info.type);
    }
    // For class methods, register `self` / `cls` with the enclosing class
    // type so `self.method()` / `cls.method()` resolve.
    if (isInClass) {
      const cls = currentClass();
      if (cls) {
        // Scan params for self/cls (the first one usually)
        for (const p of params.namedChildren) {
          if (p.type === "identifier") {
            if (p.text === "self" || p.text === "cls") {
              out.set(p.text, cls.name);
            }
            break; // only the first positional param is self/cls
          }
        }
      }
    }
    return out;
  }

  function resolveReceiverType(receiver: TsNode): string | undefined {
    switch (receiver.type) {
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // Could be a class/module name — return the bare name as a guess
        return receiver.text;
      }
      case "attribute": {
        // x.y — look up y in x's class fields
        const obj = receiver.childForFieldName("object");
        const attr = receiver.childForFieldName("attribute");
        if (!obj || attr?.type !== "identifier") return undefined;
        const objType = resolveReceiverType(obj);
        if (!objType) return undefined;
        // Look up attribute in the class table only for classes in this file.
        // We have only the current class's field map handy; cross-file
        // struct table would be a future enhancement.
        if (objType === currentClass()?.name) {
          return currentClass()?.fields.get(attr.text);
        }
        return undefined;
      }
      case "call": {
        // SomeType(...) → type is SomeType (Python's class instantiation)
        const fn = receiver.childForFieldName("function");
        if (fn?.type === "identifier") return fn.text;
        return undefined;
      }
      default:
        return undefined;
    }
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_statement": {
        // import X.Y as Z  /  import X
        for (const child of node.namedChildren) {
          let spec: string | null = null;
          if (child.type === "dotted_name") spec = child.text;
          else if (child.type === "aliased_import") {
            const inner = child.childForFieldName("name");
            if (inner?.type === "dotted_name") spec = inner.text;
          }
          if (spec && !seenImportSpecs.has(spec)) {
            seenImportSpecs.add(spec);
            imports.push({
              rawSpec: spec,
              resolvedPath: resolvePythonImport(spec, file.rel, ix),
            });
          }
        }
        return;
      }

      case "import_from_statement": {
        // from X import ...  or  from .X import ...  or  from . import ...
        const moduleNode = node.childForFieldName("module_name");
        if (moduleNode) {
          const spec = moduleNode.text;
          if (!seenImportSpecs.has(spec)) {
            seenImportSpecs.add(spec);
            imports.push({
              rawSpec: spec,
              resolvedPath: resolvePythonImport(spec, file.rel, ix),
            });
          }
        }
        return;
      }

      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anon>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectClassFields(bodyNode)
          : new Map<string, string>();

        // Look for __init__ to capture self.X = param assignments
        if (bodyNode) {
          for (const stmt of bodyNode.namedChildren) {
            if (stmt.type !== "function_definition") continue;
            const stmtName = stmt.childForFieldName("name")?.text;
            if (stmtName !== "__init__") continue;
            const initBody = stmt.childForFieldName("body");
            if (!initBody) continue;
            // Build a temp class scope so collectMethodParams can see it
            // — but we actually push it below. Just collect param types
            // directly here:
            const params = stmt.childForFieldName("parameters");
            const initParamTypes = new Map<string, string>();
            if (params) {
              for (const p of params.namedChildren) {
                const info = extractPythonParam(p);
                if (info && info.type) initParamTypes.set(info.name, info.type);
              }
            }
            collectInitSelfAssignments(initBody, initParamTypes, fields);
          }
        }

        // v0.77: collect method names BEFORE recursing — needed to
        // populate ParsedClass.methodNames so the codeGraph aggregator
        // can match them to FunctionDef entries by (containerType,
        // name). Methods may be either `function_definition` or
        // `decorated_definition` wrapping one (e.g. @property,
        // @abstractmethod, @staticmethod).
        const methodNames: string[] = [];
        if (bodyNode) {
          for (const member of bodyNode.namedChildren) {
            let fnNode: TsNode | null = null;
            if (member.type === "function_definition") fnNode = member;
            else if (member.type === "decorated_definition") {
              fnNode =
                member.namedChildren.find(
                  (c) => c.type === "function_definition"
                ) ?? null;
            }
            if (fnNode) {
              const m = fnNode.childForFieldName("name");
              if (m && m.text) methodNames.push(m.text);
            }
          }
        }

        classStack.push({ name: className, fields });
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();

        // v0.77: emit ParsedClass for the Architecture tab. Skip
        // anonymous shapes. Python doesn't have a separate `interface`
        // construct (Protocol classes from typing exist but are
        // marker types — we treat them as abstract). isInterface
        // stays false; isAbstract reflects ABC / ABCMeta / Protocol
        // parents.
        if (className !== "<anon>" && bodyNode) {
          const { parentClass, baseClasses, isAbstract } = extractPythonParents(node);
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: collectFullPythonFields(bodyNode),
            methodNames,
            parentClass,
            ...(baseClasses.length > 1 ? { baseClasses } : {}),
            implements: [],
            isInterface: false,
            isAbstract,
          });
        }
        return;
      }

      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const isInClass = classStack.length > 0;
        const locals = collectMethodParams(node, isInClass);
        // Claim the marker NOW: the body is walked before we push, and a
        // decorated function nested in this one would otherwise overwrite it.
        const entryPoint = pendingEntryPoint ?? undefined;
        pendingEntryPoint = null;

        const scope = {
          name: fnName,
          locals,
          decisionPoints: 0,
          isInClassMethod: isInClass,
          assembled: new Set<string>(),
          tainted: new Map<string, TaintOrigin>(),
        };
        // A declared route handler receives its path and query parameters as
        // arguments — in FastAPI that IS the request data, with no `request`
        // object in sight. `self`, `cls` and `request` are the framework's
        // own, not user input.
        const paramNames: string[] = [];
        for (const p of node.childForFieldName("parameters")?.namedChildren ?? []) {
          if (!p) continue;
          const pname = parameterName(p);
          if (!pname || pname === "self" || pname === "cls") continue;
          paramNames.push(pname);
          if (pname === "request") continue; // the framework's object, not input
          const line = p.startPosition.row + 1;
          scope.tainted.set(
            pname,
            entryPoint
              ? {
                  kind: "source",
                  ev: { source: `${fnName}(${pname})`, line, via: pname },
                }
              : { kind: "param", name: pname, line }
          );
        }
        methodStack.push(scope);
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: isInClass ? currentClass()?.name : undefined,
          bodyHash: body ? hashSubtree(body) : undefined,
          entryPoint,
          ...(paramNames.length ? { params: paramNames } : {}),
        });
        return;
      }

      case "decorated_definition": {
        // Children are visited exactly as the default case would, so decorator
        // call edges keep being recorded — only the marker is new.
        for (const child of node.namedChildren) {
          if (!child || child.type !== "decorator") continue;
          const route = readRouteDecorator(child);
          if (route) {
            pendingEntryPoint = route;
            break;
          }
        }
        for (const child of node.namedChildren) visit(child);
        pendingEntryPoint = null;
        return;
      }

      case "assignment": {
        // Local annotated assignment: x: Foo = ... or `x = SomeType()`
        const left = node.childForFieldName("left");
        const typeNode = node.childForFieldName("type");
        const valueNode = node.childForFieldName("right");
        const m = currentMethod();
        if (left?.type === "identifier" && m) {
          let typeName: string | null = null;
          if (typeNode) {
            typeName = extractPyTypeName(typeNode);
          } else if (valueNode?.type === "call") {
            // x = SomeClass(...) — the constructor's name IS the type.
            const fn = valueNode.childForFieldName("function");
            if (fn?.type === "identifier") typeName = fn.text;
          }
          if (typeName) m.locals.set(left.text, typeName);
        }
        // Independent of the type pass above, and not gated on being inside a
        // function — module-level query building is just as real.
        if (left?.type === "identifier" && isAssembledString(valueNode)) {
          markAssembled(left.text);
        }
        if (left?.type === "identifier") {
          const t = taintOf(valueNode);
          // Record the local it now travels through, so the finding can say
          // where the value entered AND what carried it to the sink.
          if (t) {
            markTainted(
              left.text,
              t.kind === "source"
                ? { kind: "source", ev: { ...t.ev, via: left.text } }
                : t
            );
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "augmented_assignment": {
        // `sql += ...` only assembles a query when TEXT is being appended.
        //
        // Measured on Zulip: marking every `+=` target flagged
        // `query += sql.SQL(...).format(field=sql.Identifier(f))` — psycopg2's
        // composition API, which exists precisely to build dynamic SQL safely
        // and escapes on the caller's behalf. That was the single reachable
        // high-severity finding on a real production codebase, and it was
        // wrong.
        //
        // So: an assembled expression or a bare name counts (we cannot see
        // what a variable holds, and that is the risky case). A call does not
        // — a function returned a value, which is not us watching text being
        // glued together. Nor does a plain literal: `q += " AND active"` is
        // still a constant query. Costs us `q += get_filter()`; that is a
        // declared miss, not a wrong answer.
        const left = node.childForFieldName("left");
        const op = node.childForFieldName("operator")?.text;
        const right = node.childForFieldName("right");
        const appendsText =
          isAssembledString(right) || right?.type === "identifier";
        if (left?.type === "identifier" && op === "+=" && appendsText) {
          markAssembled(left.text);
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "call": {
        const fnNode = node.childForFieldName("function");
        if (fnNode) {
          let calleeName: string | null = null;
          let calleeType: string | undefined;
          // A method call (obj.attr()) has a receiver. Record it so the
          // resolver's strict-receiver guard blocks single-candidate matches
          // of common method names on untyped receivers (see javascript.ts).
          let hasReceiver = false;
          if (fnNode.type === "identifier") {
            calleeName = fnNode.text;
            // Python doesn't have implicit self — bare call is global
          } else if (fnNode.type === "attribute") {
            hasReceiver = true;
            const attrNode = fnNode.childForFieldName("attribute");
            const objNode = fnNode.childForFieldName("object");
            if (attrNode?.type === "identifier") calleeName = attrNode.text;
            if (objNode) calleeType = resolveReceiverType(objNode);
          }
          if (calleeName && isUrlconf) {
            const row = readUrlconfRow(node, calleeName);
            if (row) routes.push(row);
          }
          if (calleeName) {
            // Not gated on isUrlconf: DRF routers are routinely registered in
            // files that never import django.urls. The ViewSet suffix carries
            // the precision instead.
            const reg = readRouterRegistration(node, fnNode, calleeName);
            if (reg) routes.push(reg);
          }
          if (calleeName && sinks.length < MAX_SINKS_PER_FILE) {
            const hit = matchSinkRule(node, fnNode, calleeName, isAssembledVar, taintOf);
            if (hit) {
              sinks.push({
                ruleId: hit.ruleId,
                severity: hit.severity,
                line: node.startPosition.row + 1,
                inFunction: currentMethod()?.name ?? null,
                inContainerType: currentClass()?.name,
                snippet: snippetAt(node.startPosition.row),
                ...(hit.taint ? { taint: hit.taint } : {}),
                ...(hit.taintedByParam ? { taintedByParam: hit.taintedByParam } : {}),
              });
            }
          }
          // What this call HANDS ON. A source-tainted argument starts a flow;
          // a parameter-derived one continues whatever the caller began. The
          // graph pass needs both to stitch a path across functions.
          let taintedArgs: TaintedArg[] | undefined;
          const callArgs = node.childForFieldName("arguments");
          if (calleeName && callArgs) {
            let position = 0;
            for (const arg of callArgs.namedChildren) {
              if (!arg) continue;
              const isKeyword = arg.type === "keyword_argument";
              const value = isKeyword ? arg.childForFieldName("value") : arg;
              const origin = taintOf(value ?? null);
              if (origin) {
                (taintedArgs ??= []).push({
                  index: isKeyword ? -1 : position,
                  ...(isKeyword
                    ? { name: arg.childForFieldName("name")?.text ?? "" }
                    : {}),
                  ...(origin.kind === "source"
                    ? { source: origin.ev.source }
                    : { param: origin.name }),
                  line: arg.startPosition.row + 1,
                });
              }
              if (!isKeyword) position++;
            }
          }
          if (calleeName) {
            calls.push({
              calleeName,
              ...(taintedArgs ? { taintedArgs } : {}),
              inFunction: currentMethod()?.name ?? null,
              // Same live scope that stamps FunctionDef.containerType — gives the
              // caller side an exact container instead of a name-only guess.
              fromContainerType: currentClass()?.name,
              calleeType,
              hasReceiver,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "elif_clause":
      case "while_statement":
      case "for_statement":
      case "except_clause":
      case "boolean_operator":
      case "conditional_expression":
      case "case_clause":
        countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;

      default:
        for (const child of node.namedChildren) visit(child);
    }
  }

  visit(tree.rootNode);

  tree.delete();
  parser.delete();

  return {
    rel: file.rel,
    imports,
    functions,
    calls,
    fileComplexity: 1 + totalDecisionPoints,
    parseError: false,
    classes: parsedClasses,
    ...(routes.length ? { routes } : {}),
    ...(sinks.length ? { sinks } : {}),
  };
}

function errorParsedFile(file: SourceFile): ParsedFile {
  return {
    rel: file.rel,
    imports: [],
    functions: [],
    calls: [],
    fileComplexity: 1,
    parseError: true,
  };
}

// ------------------- Plugin -------------------

export const pythonPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (lang) return;
    lang = await loadBuiltinGrammar("tree-sitter-python");
  },

  languageFor(_ext) {
    if (!lang) {
      throw new Error(
        `python plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    // Kept for any caller that prefers the standard pipeline; the
    // orchestrator routes through parseDirect since v0.18.
    return QUERIES;
  },

  parseDirect: parsePyDirect,

  resolveImport: resolvePythonImport,
} satisfies CodeAnalysisPlugin;
