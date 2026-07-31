// JavaScript / TypeScript plugin.
//
// Covers the JS family (.js, .jsx, .mjs, .cjs) plus TypeScript (.ts, .tsx,
// .mts, .cts). They share the same module system so they live in one plugin,
// but TS needs its own grammar for type annotations and .tsx needs the tsx
// grammar for JSX inside a typed file. Three grammars, one plugin.
//
// Resolver responsibilities (in priority order):
//   1. tsconfig path mappings (loaded per-repo via prepareForRepo)
//   2. Relative/absolute path resolution
//   3. TypeScript ESM convention: ".js" specifier → ".ts" file (and the
//      .jsx/.tsx, .mjs/.mts, .cjs/.cts pairs)

import path from "node:path";
import { Parser } from "web-tree-sitter";
import type { Language, Node as TsNode } from "web-tree-sitter";
import type {
  SinkFinding,
  TaintEvidence,
  ClassMemberVisibility,
  CodeAnalysisPlugin,
  FileIndex,
  ParsedCall,
  ParsedClass,
  ParsedField,
  ParsedFile,
  ParsedFunction,
  ParsedImport,
  PluginQueries,
  SourceFile,
  TestCaseMeta,
  TestFileMeta,
} from "../types";
import { loadBuiltinGrammar } from "../runtime";
import { hashSubtree } from "../astHash";
import {
  applyPathMapping,
  loadTsconfigPaths,
  type TsPathMappings,
} from "../tsconfig";
import {
  loadWorkspacePackages,
  type WorkspaceMap,
} from "../workspaces";

/** Per-repo state carried on FileIndex.extras["javascript"]. Both fields are
 *  optional — repos without a tsconfig or workspaces still work. */
interface JsResolverContext {
  tsPathMappings?: TsPathMappings;
  workspaces?: WorkspaceMap;
}

const EXTENSIONS = [
  "js", "jsx", "mjs", "cjs",
  "ts", "tsx", "mts", "cts",
] as const;

type GrammarSlot = "javascript" | "typescript" | "tsx";

const langs: Record<GrammarSlot, Language | null> = {
  javascript: null,
  typescript: null,
  tsx: null,
};

function slotFor(ext: string): GrammarSlot {
  if (ext === "tsx") return "tsx";
  if (ext === "ts" || ext === "mts" || ext === "cts") return "typescript";
  return "javascript"; // js, jsx, mjs, cjs
}

// ------------------- Tree-sitter queries -------------------

const IMPORTS_QUERY = `
; ES module: import X from "y"
(import_statement source: (string (string_fragment) @spec))

; Re-export: export ... from "y"
(export_statement source: (string (string_fragment) @spec))

; CommonJS require("y")
((call_expression
  function: (identifier) @_fn
  arguments: (arguments (string (string_fragment) @spec)))
 (#eq? @_fn "require"))

; Dynamic import: import("y")
(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @spec)))
`;

const FUNCTION_DEFS_QUERY = `
; function foo() {}
(function_declaration name: (identifier) @name body: (statement_block) @body)

; class Foo { bar() {} }
(method_definition name: (property_identifier) @name body: (statement_block) @body)

; const foo = () => {} / const foo = () => expr
(variable_declarator
  name: (identifier) @name
  value: (arrow_function body: (_) @body))

; const foo = function() {}
(variable_declarator
  name: (identifier) @name
  value: (function_expression body: (statement_block) @body))
`;

const CALL_SITES_QUERY = `
; foo()
(call_expression function: (identifier) @callee)

; obj.foo()
(call_expression function: (member_expression property: (property_identifier) @callee))
`;

const DECISION_POINTS_QUERY = `
(if_statement) @p
(while_statement) @p
(for_statement) @p
(for_in_statement) @p
(do_statement) @p
(switch_case) @p
(ternary_expression) @p
(catch_clause) @p
(binary_expression operator: "&&") @p
(binary_expression operator: "||") @p
(binary_expression operator: "??") @p
`;

const QUERIES: PluginQueries = {
  imports: IMPORTS_QUERY,
  functionDefs: FUNCTION_DEFS_QUERY,
  callSites: CALL_SITES_QUERY,
  decisionPoints: DECISION_POINTS_QUERY,
};

// ------------------- Import resolution -------------------

/** Extensions we'll try when a spec lacks one, ordered TS-first because TS
 *  files outnumber JS in modern repos. */
const RESOLVE_EXTS = [
  "ts", "tsx", "mts", "cts",
  "js", "jsx", "mjs", "cjs",
];

/** TypeScript ESM convention: source file is .ts but spec is written as .js
 *  (TS doesn't rewrite specifiers, so it must point at the runtime filename).
 *  Same logic for the jsx/tsx, mjs/mts, cjs/cts pairs. Maps the .js-side ext
 *  to its .ts-side equivalent so the resolver can retry once the literal
 *  spec doesn't resolve. */
const JS_TO_TS: Record<string, string> = {
  js: "ts",
  jsx: "tsx",
  mjs: "mts",
  cjs: "cts",
};

const PLUGIN_NAME = "javascript";

function resolveJsImport(
  spec: string,
  fromPath: string,
  ix: FileIndex
): string | null {
  const ctx = ix.extras.get(PLUGIN_NAME) as JsResolverContext | undefined;

  // 1. tsconfig path mapping — runs first so @/foo and ~/bar specs route
  //    through user-declared aliases before we treat them as external.
  if (ctx?.tsPathMappings) {
    for (const candidate of applyPathMapping(spec, ctx.tsPathMappings)) {
      const resolved = resolveAgainstFiles(candidate, ix);
      if (resolved) return resolved;
    }
  }

  // 2. Workspace packages — @scope/name or @scope/name/subpath. Catches the
  //    cross-package imports in pnpm/yarn/npm monorepos that aren't declared
  //    in tsconfig paths.
  if (ctx?.workspaces) {
    const direct = ctx.workspaces.get(spec);
    if (direct) {
      const resolved = resolveAgainstFiles(direct.sourcePath, ix);
      if (resolved) return resolved;
    }
    for (const [pkgName, ws] of ctx.workspaces) {
      if (!spec.startsWith(pkgName + "/")) continue;
      const sub = spec.slice(pkgName.length + 1);
      // Try the subpath as written; then under src/ since that's where the
      // sources actually live in most monorepo packages.
      const a = resolveAgainstFiles(
        path.posix.join(ws.packageDir, sub),
        ix
      );
      if (a) return a;
      const b = resolveAgainstFiles(
        path.posix.join(ws.packageDir, "src", sub),
        ix
      );
      if (b) return b;
    }
  }

  // 3. Relative / absolute paths in the repo. Anything else (bare specifiers
  //    not matched by tsconfig OR workspaces) is external.
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = path.posix.dirname(fromPath);
  // Trailing slash on relative specs interacts oddly with `..` segments
  // ("../../" normalizes one level higher than "../..") so strip it. Trailing
  // slash on import specs is rarely meaningful — at most it suggests
  // directory-with-index, which we already try below.
  const cleanSpec =
    spec.length > 1 ? spec.replace(/\/+$/, "") : spec;
  const base = path.posix.normalize(path.posix.join(fromDir, cleanSpec));
  return resolveAgainstFiles(base, ix);
}

/** Try a candidate path against the file index, including extension fallback,
 *  TS-ESM js→ts swap, and directory-with-index resolution. */
function resolveAgainstFiles(
  candidate: string,
  ix: FileIndex
): string | null {
  // Empty / "." candidate means "repo root" — happens when a file like
  // examples/auth/index.js does `import "../.."`. Look for index.* at the
  // root directly, since "/index.ts" or "./index.ts" wouldn't match the
  // unprefixed keys we store in byPath.
  if (candidate === "" || candidate === ".") {
    for (const ext of RESOLVE_EXTS) {
      const cand = `index.${ext}`;
      if (ix.byPath.has(cand)) return cand;
    }
    return null;
  }

  // Exact match — handles specs that already include the right extension
  if (ix.byPath.has(candidate)) return candidate;

  // TypeScript ESM: spec uses .js-family ext but actual file is .ts-family
  const m = candidate.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) {
    const swapped =
      candidate.slice(0, -m[1].length) + JS_TO_TS[m[1]];
    if (ix.byPath.has(swapped)) return swapped;
  }

  // Append each known extension
  for (const ext of RESOLVE_EXTS) {
    const cand = `${candidate}.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  // Directory with index file
  for (const ext of RESOLVE_EXTS) {
    const cand = `${candidate}/index.${ext}`;
    if (ix.byPath.has(cand)) return cand;
  }

  return null;
}

// ------------------- Type extraction (TypeScript) -------------------
//
// JS files have no type annotations so these helpers always return null —
// the walker then leaves calleeType undefined for those files and
// pickCallTarget falls back to name + same-file + imported-files heuristics.
// TS files (and TSX/MTS/CTS) supply explicit types via type_annotation
// nodes that we strip down to the bare class name used in our index.

/** Pull the bare class name out of a `: Type` annotation node. The
 *  type_annotation wraps a single type expression (type_identifier,
 *  generic_type, etc.). Returns null for types we can't resolve to a
 *  named class (unions, intersections, function types, etc.). */
function extractTypeFromAnnotation(annotation: TsNode): string | null {
  for (const child of annotation.namedChildren) {
    return extractTsTypeName(child);
  }
  return null;
}

function extractTsTypeName(node: TsNode): string | null {
  switch (node.type) {
    case "type_identifier":
      return node.text;
    case "predefined_type":
      // boolean / string / number / void / etc — primitives won't match a
      // FunctionDef.containerType in our index, but return them so the
      // type-table values stay informative for debugging.
      return null;
    case "generic_type": {
      // Map<K, V> → "Map"; the first named child is the bare name.
      for (const child of node.namedChildren) {
        if (
          child.type === "type_identifier" ||
          child.type === "nested_type_identifier"
        ) {
          return extractTsTypeName(child);
        }
      }
      return null;
    }
    case "nested_type_identifier": {
      // pkg.Foo / Map.Entry → "Foo" / "Entry"
      const parts = node.text.split(".");
      return parts[parts.length - 1] ?? null;
    }
    // union_type, intersection_type, tuple_type, literal_type, function_type,
    // object_type, type_query, conditional_type — all return null. We can't
    // resolve a method call against a sum type without runtime info.
    default:
      return null;
  }
}

/** For a parameter shape (required_parameter / optional_parameter / TS
 *  variants), pull (paramName, typeName?). The pattern child is usually an
 *  identifier; we ignore destructuring patterns in v1 (rare in scope of
 *  type-aware blast-radius). */
function extractParamNameAndType(
  paramNode: TsNode
): { name: string; type: string | null; isParamProperty: boolean } | null {
  // TS `required_parameter` / `optional_parameter` have:
  //   accessibility_modifier?  pattern: identifier  type: type_annotation?
  //   value: ?
  // Plain JS `formal_parameters` has bare `identifier` children — no type.
  if (paramNode.type === "identifier") {
    return { name: paramNode.text, type: null, isParamProperty: false };
  }

  // Detect TS parameter properties (constructor(public x: Foo)) — these
  // implicitly create class fields.
  let isParamProperty = false;
  for (const child of paramNode.namedChildren) {
    if (child.type === "accessibility_modifier") {
      isParamProperty = true;
      break;
    }
  }
  // `readonly` modifier (no accessibility but still creates a field) — also
  // common in TS constructors.
  for (const child of paramNode.children) {
    if (child.type === "readonly") {
      isParamProperty = true;
      break;
    }
  }

  const patternNode = paramNode.childForFieldName("pattern");
  if (!patternNode || patternNode.type !== "identifier") return null;
  const name = patternNode.text;

  const typeNode = paramNode.childForFieldName("type");
  const type = typeNode ? extractTypeFromAnnotation(typeNode) : null;

  return { name, type, isParamProperty };
}

// ------------------- DOM XSS sinks (v0.82+) -------------------
//
// The security layer was Python-only. Every JS/TS repo analysed returned zero
// findings — not "clean", just unexamined. This is the first JavaScript sink
// set, and it follows the discipline the Python rules arrived at the hard way:
//
// TAINT IS REQUIRED. `el.innerHTML = x` is one of the most common lines in
// front-end JavaScript and is usually harmless (rendering internal data).
// Flagging it unconditionally would be the precision disaster this project has
// walked into three times (weak-hash, csrf_exempt, loose mark_safe). The rule
// fires only when the value provably came from an attacker-controllable DOM
// source in the same function.

/** Browser-side values an attacker controls: the URL, the referrer, the frame
 *  name. `location.search`, `location.hash`, `document.URL`, `window.name`. */
const JS_TAINT_SOURCE = /(^|\.)(location|document)\.(search|hash|href|URL|documentURI|referrer)\b|(^|\.)window\.name\b|(^|\.)location\b\s*$/;

/** Functions that render a value harmless before it reaches markup. */
const JS_SANITIZERS = new Set([
  "encodeURIComponent", "encodeURI", "escape", "sanitize", "DOMPurify", "Number", "parseInt", "parseFloat",
]);

/** Properties whose assignment parses the value as HTML. */
const JS_HTML_PROPERTIES = new Set(["innerHTML", "outerHTML"]);

/** Calls that parse their argument as HTML or as code. */
const JS_HTML_CALLS = new Set(["write", "writeln", "insertAdjacentHTML", "html"]);

// ------------------- parseDirect: AST walk with type tracking -------------------
//
// Same shape as plugins/java.ts and plugins/go.ts but adapted to the JS/TS
// AST. JS files (no type annotations) gracefully degrade — the walker still
// emits ParsedFunctions with containerType from class context, and calls
// with calleeType set when receiver = `this` or `new Foo()`. Type tracking
// fires only when the source actually has type annotations.
//
// Important difference from Java/Go: JS does NOT have implicit `this` for
// bare calls inside methods. `helper()` from inside a class method does not
// mean `this.helper()` — JS requires explicit `this.helper()`. So bare calls
// have undefined calleeType (unlike Java's implicit-this convention).

interface JsClassScope {
  name: string;
  /** Field name → type. Includes regular field declarations AND constructor
   *  parameter properties (`constructor(private x: Foo)` → adds x:Foo). */
  fields: Map<string, string>;
}

interface JsMethodScope {
  name: string;
  locals: Map<string, string>;
  decisionPoints: number;
  /** Locals holding a value derived from a DOM source, with the evidence. */
  tainted: Map<string, TaintEvidence>;
}

// ------------------- Weak-Suite: assertion-quality extraction -------------------
//
// Per test file, measure how much its tests actually VERIFY vs merely execute.
// This is the language-specific half of the Weak-Suite signal (Arc 1): every
// JS/TS assertion idiom lives HERE and nowhere else (architecture invariant #1).
// The output is a language-NEUTRAL TestFileMeta that the aggregate/signal/UI
// consume as plain numbers.
//
// "Publish the math": the idiom tables below ARE the methodology. A trivial
// (smoke) oracle checks existence / truthiness / that nothing threw — it raises
// coverage without catching regressions, the deceptive metric in AI-generated
// suites. A meaningful oracle checks an actual value.

/** Functions that open a test case whose callback we scan. Member forms
 *  (it.only, test.each, it.concurrent) match on this leftmost identifier. */
const TEST_RUNNERS = new Set(["it", "test", "specify", "fit"]);
/** Member modifiers that STILL open a scored test case (`it.only`, `test.each`,
 *  `it.concurrent`). Anything else on a runner — describe, beforeEach/afterEach
 *  hooks, `test.step`, `.skip`/`.todo`, `test.use` — is a container / hook /
 *  step / skipped test, NOT its own case. This allow-list is what keeps
 *  Playwright's `test.describe` / `test.beforeEach` / `test.step` out of the
 *  case count. */
const CASE_MODIFIERS = new Set(["only", "each", "concurrent", "failing"]);
/** Call-form matchers that verify next to nothing (existence/truthiness/threw). */
const TRIVIAL_MATCHERS = new Set([
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
  "toBeTruthy",
  "toBeFalsy",
  "toBeNaN",
  "toThrow",
  "toThrowError",
  "toBeInstanceOf",
  "toHaveBeenCalled", // called — but not asserted WITH WHAT — weak
  "ok", // assert.ok(x) — truthiness only
]);
/** Chai property-getter terminals that verify next to nothing. `.to.be.true` /
 *  `.to.be.false` are real value checks, so they are deliberately NOT here. */
const GETTER_TRIVIAL = new Set([
  "null",
  "undefined",
  "exist",
  "ok",
  "empty",
  "NaN",
]);

/** Cheap path gate so the extra walk only runs on plausible JS/TS test files.
 *  Path-based, hence language-neutral. */
function looksLikeJsTestFile(rel: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ||
    /(^|\/)(__tests__|tests?|spec)\//.test(rel)
  );
}

/** If this call opens a scored test CASE, return the runner root ("it"/"test"/…);
 *  else null. Bare `it(...)`/`test(...)`, or a member form whose EVERY modifier
 *  is a case modifier (`it.only`, `test.each`, `it.concurrent.only`). Rejects
 *  containers (`describe`, `test.describe`), hooks (`test.beforeEach`), steps
 *  (`test.step`), skipped tests (`.skip`/`.todo`), and `test.describe.only`
 *  (a container, because `describe` isn't a case modifier). */
function caseOpenerRoot(fnNode: TsNode): string | null {
  let node = fnNode;
  // `test.each([...])(name, cb)` — the callee is the `test.each([...])`
  // invocation; unwrap it to reach the `test.each` member chain.
  if (node.type === "call_expression") {
    const inner = node.childForFieldName("function");
    if (!inner) return null;
    node = inner;
  }
  if (node.type === "identifier") {
    return TEST_RUNNERS.has(node.text) ? node.text : null;
  }
  if (node.type !== "member_expression") return null;
  let n: TsNode | null = node;
  while (n && n.type === "member_expression") {
    const prop = n.childForFieldName("property");
    if (prop?.type !== "property_identifier" || !CASE_MODIFIERS.has(prop.text)) {
      return null;
    }
    n = n.childForFieldName("object");
  }
  return n && n.type === "identifier" && TEST_RUNNERS.has(n.text) ? n.text : null;
}

/** Walk an assertion chain's object side to find its library root: an
 *  `expect(...)` / `expect.soft(...)` call, or an `assert` identifier/property.
 *  Handles namespaced forms (`chai.assert.equal`, `expect.soft(x).toBe(y)`). */
function assertionKind(objNode: TsNode): "expect" | "assert" | null {
  let n: TsNode | null = objNode;
  while (n) {
    if (n.type === "call_expression") {
      const f = n.childForFieldName("function");
      if (f?.type === "identifier" && f.text === "expect") return "expect";
      if (
        f?.type === "member_expression" &&
        f.childForFieldName("object")?.text === "expect"
      ) {
        return "expect"; // expect.soft(x) / expect.hard(x)
      }
      return null;
    }
    if (n.type === "member_expression") {
      const prop = n.childForFieldName("property");
      if (prop?.text === "assert") return "assert"; // chai.assert.<...>
      n = n.childForFieldName("object");
      continue;
    }
    if (n.type === "identifier") {
      return n.text === "assert" ? "assert" : n.text === "expect" ? "expect" : null;
    }
    return null;
  }
  return null;
}

/** The `expect(...)`/`expect.soft(...)` call node in a chain, so it can be
 *  marked consumed and not re-counted as a bare expect. */
function expectCallNode(objNode: TsNode): TsNode | null {
  let n: TsNode | null = objNode;
  while (n) {
    if (n.type === "call_expression") {
      const f = n.childForFieldName("function");
      if (f?.type === "identifier" && f.text === "expect") return n;
      if (
        f?.type === "member_expression" &&
        f.childForFieldName("object")?.text === "expect"
      ) {
        return n;
      }
      return null;
    }
    if (n.type === "member_expression") {
      n = n.childForFieldName("object");
      continue;
    }
    return null;
  }
  return null;
}

/** The matcher property at the end of an assertion chain (`toBe` in
 *  `expect(x).not.toBe(y)`, `equal` in `assert.equal(...)`), or null. */
function matcherOf(matcherCall: TsNode): string | null {
  const callee = matcherCall.childForFieldName("function");
  if (!callee || callee.type !== "member_expression") return null;
  const prop = callee.childForFieldName("property");
  return prop?.type === "property_identifier" ? prop.text : null;
}

/** Raw text of a string literal node (quotes stripped). */
function stringLiteralText(node: TsNode): string {
  for (const child of node.namedChildren) {
    if (child.type === "string_fragment") return child.text;
  }
  return "";
}

/** Extract per-test-case assertion quality for one file. Self-contained walk
 *  over the already-parsed tree — it does NOT touch the main visit() pass.
 *  Returns undefined when no test cases are found (nothing to score). */
function extractTestMeta(root: TsNode): TestFileMeta | undefined {
  const cases: TestCaseMeta[] = [];
  const trivialNames = new Set<string>();
  // Inner `expect(x)` calls already attributed to an outer matcher, so a
  // chained assertion is counted exactly once (see the double-count gotcha).
  const consumed = new Set<number>();

  function record(tc: TestCaseMeta, matcher: string | null, trivial: boolean) {
    tc.assertions++;
    if (trivial) {
      tc.trivialAssertions++;
      if (matcher) trivialNames.add(matcher);
    } else {
      tc.hasMeaningfulOracle = true;
    }
  }

  /** A bare `expect(x)` call: either a chai property-getter assertion
   *  (`expect(x).to.be.true`) — classified by the terminal getter word — or a
   *  truly bare `expect(x);` — pure smoke. */
  function classifyBareExpect(callNode: TsNode, tc: TestCaseMeta) {
    let term = callNode;
    let p = callNode.parent;
    while (p && p.type === "member_expression") {
      term = p;
      p = p.parent;
    }
    consumed.add(callNode.id);
    if (term === callNode) {
      record(tc, null, true); // truly bare expect(x) — smoke
      return;
    }
    if (p && p.type === "call_expression") {
      return; // a matcher CALL wraps it — counted by the member branch instead
    }
    // Getter assertion: the terminal property is the assertion word.
    const prop = term.childForFieldName("property");
    const g = prop?.type === "property_identifier" ? prop.text : null;
    record(tc, g, !g || GETTER_TRIVIAL.has(g));
  }

  function classifyAssertion(callNode: TsNode, fn: TsNode, tc: TestCaseMeta) {
    if (fn.type === "identifier") {
      if (fn.text === "assert") {
        record(tc, null, true); // assert(x) — truthiness only
      } else if (fn.text === "expect" && !consumed.has(callNode.id)) {
        classifyBareExpect(callNode, tc);
      }
      return;
    }
    if (fn.type !== "member_expression") return;
    const obj = fn.childForFieldName("object");
    if (!obj) return;
    // `expect.soft(x)` / `expect.assertions(n)` — a modifier on expect, not a
    // matcher. It's the chain ROOT (consumed by its outer matcher) or meta;
    // never its own assertion.
    if (obj.type === "identifier" && obj.text === "expect") return;
    const kind = assertionKind(obj);
    if (!kind) return;
    if (kind === "expect") {
      const ec = expectCallNode(obj);
      if (ec) consumed.add(ec.id); // don't re-count the inner expect()
    }
    const matcher = matcherOf(callNode);
    record(tc, matcher, !matcher || TRIVIAL_MATCHERS.has(matcher));
  }

  /** Scan one test-case callback body, tallying assertions into `tc`. Stops at
   *  a nested CASE opener (its assertions are its own); `test.step` and hooks
   *  are NOT case openers, so their assertions count toward the enclosing case. */
  function scanBody(node: TsNode, tc: TestCaseMeta) {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn) {
        if (caseOpenerRoot(fn)) return;
        classifyAssertion(node, fn, tc);
      }
    }
    for (const child of node.namedChildren) scanBody(child, tc);
  }

  /** Top-level walk: open a case for each case-opening runner with a callback. */
  function walk(node: TsNode) {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn && caseOpenerRoot(fn)) {
        const args = node.childForFieldName("arguments");
        const callback = args?.namedChildren.find(
          (a) => a.type === "arrow_function" || a.type === "function_expression"
        );
        if (callback) {
          const nameArg = args?.namedChildren.find((a) => a.type === "string");
          const tc: TestCaseMeta = {
            name: nameArg ? stringLiteralText(nameArg) : "",
            line: node.startPosition.row + 1,
            assertions: 0,
            trivialAssertions: 0,
            hasMeaningfulOracle: false,
          };
          const body = callback.childForFieldName("body");
          if (body) scanBody(body, tc);
          cases.push(tc);
        }
      }
    }
    for (const child of node.namedChildren) walk(child);
  }

  walk(root);
  if (cases.length === 0) return undefined;
  return { cases, trivialOracleNames: [...trivialNames].sort() };
}

function parseJsDirect(file: SourceFile, ix: FileIndex): ParsedFile {
  const lang = langs[slotFor(file.ext)];
  if (!lang) {
    throw new Error(
      `javascript plugin not loaded — call plugin.load() before parseDirect()`
    );
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
  const sinks: SinkFinding[] = [];
  const moduleTainted = new Map<string, TaintEvidence>();

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
    const t = file.content.slice(start, end).trim();
    return t.length > 200 ? `${t.slice(0, 200)}\u2026` : t;
  };

  const markJsTainted = (name: string, ev: TaintEvidence) => {
    (currentMethod()?.tainted ?? moduleTainted).set(name, ev);
  };
  /** Mirrors clearTainted in the Python plugin, for the same reason: without
   *  it, `v = DOMPurify.sanitize(v)` left `v` tainted and the innerHTML below
   *  was reported as js-dom-xss — the fix flagged as the bug. */
  const clearJsTainted = (name: string) => {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      if (methodStack[i].tainted.delete(name)) return;
    }
    moduleTainted.delete(name);
  };
  /** See the Python plugin: the walk has no control-flow graph, so a rebind
   *  inside a branch cannot be trusted to untaint what follows it. */
  let jsBranchDepth = 0;
  const jsTaintedVar = (name: string): TaintEvidence | null => {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const hit = methodStack[i].tainted.get(name);
      if (hit) return hit;
    }
    return moduleTainted.get(name) ?? null;
  };

  /** Does this expression carry an attacker-controllable DOM value? Mirrors the
   *  Python evaluator: conservative, and anything it cannot explain is null. */
  const jsTaintOf = (node: TsNode | null): TaintEvidence | null => {
    if (!node) return null;
    const here = () => node.startPosition.row + 1;
    switch (node.type) {
      case "identifier":
        return jsTaintedVar(node.text);
      case "member_expression":
      case "subscript_expression": {
        if (JS_TAINT_SOURCE.test(node.text)) {
          return { source: node.text.split("(")[0], line: here() };
        }
        return jsTaintOf(node.childForFieldName("object") ?? null);
      }
      case "call_expression": {
        const fn = node.childForFieldName("function");
        const name =
          fn?.type === "identifier"
            ? fn.text
            : fn?.childForFieldName("property")?.text;
        if (name && JS_SANITIZERS.has(name)) return null;
        const viaReceiver = jsTaintOf(fn?.childForFieldName("object") ?? null);
        if (viaReceiver) return viaReceiver;
        for (const arg of node.childForFieldName("arguments")?.namedChildren ?? []) {
          const t = jsTaintOf(arg ?? null);
          if (t) return t;
        }
        return null;
      }
      case "template_string": {
        for (const part of node.namedChildren) {
          if (part?.type !== "template_substitution") continue;
          const t = jsTaintOf(part.namedChildren[0] ?? null);
          if (t) return t;
        }
        return null;
      }
      case "binary_expression":
        return (
          jsTaintOf(node.childForFieldName("left")) ??
          jsTaintOf(node.childForFieldName("right"))
        );
      default:
        return null;
    }
  };

  const emitSink = (ruleId: string, row: number, taint: TaintEvidence) => {
    if (sinks.length >= 100) return;
    sinks.push({
      ruleId,
      severity: "high",
      line: row + 1,
      inFunction: currentMethod()?.name ?? null,
      snippet: snippetAt(row),
      taint,
    });
  };
  /** v0.70: full ParsedClass entries for the Architecture tab.
   *  Built up alongside the existing classStack as the walker
   *  enters each class_declaration / interface_declaration. */
  const parsedClasses: ParsedClass[] = [];
  let totalDecisionPoints = 0;

  const seenImportSpecs = new Set<string>();
  const classStack: JsClassScope[] = [];
  const methodStack: JsMethodScope[] = [];

  function currentClass(): JsClassScope | null {
    return classStack[classStack.length - 1] ?? null;
  }
  function currentMethod(): JsMethodScope | null {
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

  /** Walk a class_body to populate the class's field map with declared
   *  field types. TS public_field_definition has a type_annotation; JS
   *  field_definition doesn't. */
  function collectClassFields(classBody: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    for (const member of classBody.namedChildren) {
      if (
        member.type !== "public_field_definition" &&
        member.type !== "field_definition"
      ) {
        continue;
      }
      const typeNode = member.childForFieldName("type");
      if (!typeNode) continue;
      const typeName = extractTypeFromAnnotation(typeNode);
      if (!typeName) continue;
      const propNode =
        member.childForFieldName("property") ??
        member.childForFieldName("name");
      if (propNode?.type === "property_identifier") {
        out.set(propNode.text, typeName);
      }
    }
    return out;
  }

  /** Walk a constructor's formal_parameters, looking for TS parameter
   *  properties (public/private/protected/readonly modifiers). Each match
   *  ALSO becomes an implicit field on the surrounding class. Returns the
   *  param-property entries to be merged into the class's field map. */
  function collectConstructorParamProperties(
    constructorNode: TsNode
  ): Map<string, string> {
    const out = new Map<string, string>();
    const params = constructorNode.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractParamNameAndType(p);
      if (info && info.isParamProperty && info.type) {
        out.set(info.name, info.type);
      }
    }
    return out;
  }

  /** v0.70: full field metadata for the Architecture tab. Like
   *  collectClassFields() but keeps every field (typed or not),
   *  records visibility / static / readonly, and follows the JS
   *  underscore-prefix convention as a private-by-convention
   *  signal when no explicit modifier is present. */
  function collectFullClassFields(classBody: TsNode): ParsedField[] {
    const out: ParsedField[] = [];
    for (const member of classBody.namedChildren) {
      if (
        member.type !== "public_field_definition" &&
        member.type !== "field_definition"
      ) {
        continue;
      }
      const propNode =
        member.childForFieldName("property") ??
        member.childForFieldName("name");
      if (propNode?.type !== "property_identifier") continue;
      const name = propNode.text;

      const typeNode = member.childForFieldName("type");
      const type = typeNode
        ? extractTypeFromAnnotation(typeNode) ?? undefined
        : undefined;

      // Modifier detection — TS fields can carry accessibility +
      // static + readonly keywords as direct child nodes. JS has no
      // explicit modifiers; underscore prefix is the closest
      // convention so we use that as a fallback.
      let visibility: ClassMemberVisibility = name.startsWith("_")
        ? "private"
        : "public";
      let isStatic = false;
      let isReadonly = false;
      for (const child of member.children) {
        if (!child) continue;
        if (child.type === "accessibility_modifier") {
          const txt = child.text;
          if (txt === "private") visibility = "private";
          else if (txt === "protected") visibility = "protected";
          else if (txt === "public") visibility = "public";
        } else if (child.type === "static") {
          isStatic = true;
        } else if (child.type === "readonly") {
          isReadonly = true;
        }
      }

      out.push({ name, type, visibility, isStatic, isReadonly });
    }
    return out;
  }

  /** Collect constructor parameter properties as full ParsedField
   *  entries — TS lets you write `constructor(public name: string)`
   *  and that implicitly declares + assigns a field. We emit them
   *  alongside the regular field declarations. */
  function collectConstructorParamFields(
    constructorNode: TsNode
  ): ParsedField[] {
    const out: ParsedField[] = [];
    const params = constructorNode.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractParamNameAndType(p);
      if (!info || !info.isParamProperty) continue;
      // The accessibility_modifier sits as a direct child of the
      // parameter node alongside the identifier.
      let visibility: ClassMemberVisibility = "public";
      let isReadonly = false;
      for (const child of p.children) {
        if (!child) continue;
        if (child.type === "accessibility_modifier") {
          const txt = child.text;
          if (txt === "private") visibility = "private";
          else if (txt === "protected") visibility = "protected";
          else if (txt === "public") visibility = "public";
        } else if (child.type === "readonly") {
          isReadonly = true;
        }
      }
      out.push({
        name: info.name,
        type: info.type ?? undefined,
        visibility,
        isStatic: false,
        isReadonly,
      });
    }
    return out;
  }

  /** Extract the parent class name from a class_heritage node when
   *  the class declares `extends Foo`. Returns undefined when no
   *  extends clause is present. */
  function extractParentClass(node: TsNode): string | undefined {
    const heritage = node.childForFieldName("class_heritage")
      ?? node.namedChildren.find((c): c is TsNode =>
        !!c && c.type === "class_heritage"
      );
    if (!heritage) return undefined;
    for (const child of heritage.namedChildren) {
      if (child.type === "extends_clause") {
        // First identifier child is the parent class name.
        for (const grand of child.namedChildren) {
          if (grand.type === "identifier") return grand.text;
          if (grand.type === "member_expression") return grand.text;
        }
      }
    }
    return undefined;
  }

  /** Extract names listed in the `implements` clause (TS only).
   *  Empty array when none present. */
  function extractImplements(node: TsNode): string[] {
    const heritage = node.childForFieldName("class_heritage")
      ?? node.namedChildren.find((c): c is TsNode =>
        !!c && c.type === "class_heritage"
      );
    if (!heritage) return [];
    const out: string[] = [];
    for (const child of heritage.namedChildren) {
      if (child.type === "implements_clause") {
        for (const grand of child.namedChildren) {
          if (grand.type === "identifier") out.push(grand.text);
          else if (grand.type === "type_identifier") out.push(grand.text);
          else if (grand.type === "generic_type") {
            const inner = grand.childForFieldName("name");
            if (inner) out.push(inner.text);
          }
        }
      }
    }
    return out;
  }

  /** Resolve the type of a call's receiver (the `object` field of a
   *  member_expression, or whatever's left of the dot). */
  function resolveReceiverType(receiver: TsNode): string | undefined {
    switch (receiver.type) {
      case "this": {
        return currentClass()?.name;
      }
      case "identifier": {
        const t = lookupVariableType(receiver.text);
        if (t) return t;
        // A bare identifier could be a class name (Foo.staticMethod()), and
        // returning it gives the type-table lookup a shot. But returning it
        // UNCONDITIONALLY stamps a variable name as a type: `console.log()`
        // arrived at the resolver as type "console", `lines.join()` as "lines".
        // That is not harmless — pickCallTarget treats any calleeType as a
        // typed receiver and takes the strict branch, which returns null on no
        // match instead of falling through to the proximity heuristics that
        // exist precisely for untyped receivers. Measured: 1,597 of 1,621 such
        // refusals carried a fabricated type; only 24 involved a real one.
        //
        // Uppercase-initial is the JS/TS convention for classes and
        // constructors, so it is the cheapest signal that separates a plausible
        // type from a variable. A miss now returns undefined, which routes the
        // call to proximity — the tier it belonged in all along.
        const first = receiver.text[0];
        if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
          return receiver.text;
        }
        return undefined;
      }
      case "member_expression": {
        // obj.field → look up field's type in obj's struct/class
        const inner = receiver.childForFieldName("object");
        const propNode = receiver.childForFieldName("property");
        if (!inner || !propNode) return undefined;
        const innerType = resolveReceiverType(inner);
        if (!innerType) return undefined;
        // Same trick as Go: look up the receiver type in the file-local
        // class field map. Most blast-radius-relevant cases are within one
        // file (this.field.method()).
        if (innerType === currentClass()?.name) {
          return currentClass()?.fields.get(propNode.text);
        }
        return undefined;
      }
      case "new_expression": {
        // (new Foo()).method() — the type IS Foo
        const constructorNode = receiver.childForFieldName("constructor");
        if (!constructorNode) return undefined;
        if (constructorNode.type === "identifier") return constructorNode.text;
        if (constructorNode.type === "nested_identifier") {
          const parts = constructorNode.text.split(".");
          return parts[parts.length - 1] ?? undefined;
        }
        return undefined;
      }
      case "parenthesized_expression": {
        const inner = receiver.namedChildren[0];
        return inner ? resolveReceiverType(inner) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Best-effort inference for the right-hand side of a variable_declarator
   *  when no type_annotation is present. Handles new_expression — the most
   *  common JS/TS pattern that gives us a known type. Other shapes need
   *  return-type tracking which is out of v1 scope. */
  function inferExpressionType(expr: TsNode): string | null {
    switch (expr.type) {
      case "new_expression": {
        const ctor = expr.childForFieldName("constructor");
        if (!ctor) return null;
        if (ctor.type === "identifier") return ctor.text;
        if (ctor.type === "nested_identifier") {
          const parts = ctor.text.split(".");
          return parts[parts.length - 1] ?? null;
        }
        return null;
      }
      case "as_expression": {
        // x as Foo → Foo
        const typeNode = expr.namedChildren[1];
        if (!typeNode) return null;
        return extractTsTypeName(typeNode);
      }
      default:
        return null;
    }
  }

  /** Process all method/constructor parameters into a map for the method's
   *  local scope. Constructor parameters with accessibility/readonly
   *  modifiers ALSO get added to the surrounding class's field map. */
  function collectMethodParams(methodNode: TsNode): Map<string, string> {
    const out = new Map<string, string>();
    const params = methodNode.childForFieldName("parameters");
    if (!params) return out;
    for (const p of params.namedChildren) {
      const info = extractParamNameAndType(p);
      if (info && info.type) out.set(info.name, info.type);
    }
    return out;
  }

  function visit(node: TsNode) {
    switch (node.type) {
      case "import_statement":
      case "export_statement": {
        // Find the source string. import_statement has a `source` field;
        // export_statement also has a `source` field for re-exports.
        const sourceNode = node.childForFieldName("source");
        if (!sourceNode) {
          // Not a re-export with a source — could be a type-only export
          // statement etc. Walk children for any nested calls (rare).
          for (const child of node.namedChildren) visit(child);
          return;
        }
        // sourceNode is a string node; the inner string_fragment has the
        // raw text we want.
        let spec: string | null = null;
        for (const child of sourceNode.namedChildren) {
          if (child.type === "string_fragment") {
            spec = child.text;
            break;
          }
        }
        if (spec && !seenImportSpecs.has(spec)) {
          seenImportSpecs.add(spec);
          imports.push({
            rawSpec: spec,
            resolvedPath: resolveJsImport(spec, file.rel, ix),
          });
        }
        return;
      }

      case "call_expression": {
        const fnNode = node.childForFieldName("function");
        if (fnNode) {
          // document.write(x) / el.insertAdjacentHTML(pos, x) / $(sel).html(x)
          // and eval(x) / new Function(x) — all parse their argument as HTML or
          // as code. Taint-gated, for the reason in the rule-table header.
          {
            const bareName = fnNode.type === "identifier" ? fnNode.text : null;
            const prop =
              fnNode.type === "member_expression"
                ? fnNode.childForFieldName("property")?.text
                : null;
            const args = node.childForFieldName("arguments")?.namedChildren ?? [];
            const positional = args.filter((a): a is TsNode => !!a);
            if (prop && JS_HTML_CALLS.has(prop) && positional.length > 0) {
              // insertAdjacentHTML's markup is the SECOND argument.
              const target = prop === "insertAdjacentHTML" ? positional[1] : positional[0];
              const t = jsTaintOf(target ?? null);
              if (t) emitSink("js-dom-xss", node.startPosition.row, t);
            } else if (bareName === "eval" && positional.length > 0) {
              const t = jsTaintOf(positional[0]);
              if (t) emitSink("js-eval", node.startPosition.row, t);
            }
          }
          // Detect require("x") / import("x") for CommonJS + dynamic imports.
          if (
            (fnNode.type === "identifier" && fnNode.text === "require") ||
            fnNode.type === "import"
          ) {
            const args = node.childForFieldName("arguments");
            if (args) {
              for (const arg of args.namedChildren) {
                if (arg.type !== "string") continue;
                let spec: string | null = null;
                for (const sub of arg.namedChildren) {
                  if (sub.type === "string_fragment") {
                    spec = sub.text;
                    break;
                  }
                }
                if (spec && !seenImportSpecs.has(spec)) {
                  seenImportSpecs.add(spec);
                  imports.push({
                    rawSpec: spec,
                    resolvedPath: resolveJsImport(spec, file.rel, ix),
                  });
                }
              }
            }
          }

          // Emit the call edge
          let calleeName: string | null = null;
          let calleeType: string | undefined;
          // A member call (`obj.method()`) has a receiver. That MUST be
          // recorded: when we can't resolve the receiver's type (library
          // objects like a tree-sitter Query, or untyped locals), the
          // resolver's strict-receiver guard is the only thing stopping a
          // call to a common method name (`.matches()`, `.find()`, `.get()`)
          // from binding to some unrelated single function that happens to
          // share the name. Without hasReceiver those became false
          // cross-module dependency edges (parse.ts → SignalsPanel.tsx).
          let hasReceiver = false;
          if (fnNode.type === "identifier") {
            calleeName = fnNode.text;
            // JS does NOT have implicit-this — bare calls inside methods
            // are global / closure refs, not class methods. Leave
            // calleeType undefined.
          } else if (fnNode.type === "member_expression") {
            hasReceiver = true;
            const propNode = fnNode.childForFieldName("property");
            const objNode = fnNode.childForFieldName("object");
            if (propNode?.type === "property_identifier") {
              calleeName = propNode.text;
            }
            if (objNode) {
              calleeType = resolveReceiverType(objNode);
            }
          }
          if (calleeName) {
            calls.push({
              calleeName,
              inFunction: currentMethod()?.name ?? null,
              // Same live scope that stamps FunctionDef.containerType — gives the
              // caller side an exact container, not a name-only guess downstream.
              fromContainerType: currentClass()?.name,
              calleeType,
              hasReceiver,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "new_expression": {
        // `new Foo()` is a constructor call — calleeName = the class.
        const ctor = node.childForFieldName("constructor");
        if (ctor) {
          let className: string | null = null;
          if (ctor.type === "identifier") className = ctor.text;
          else if (ctor.type === "nested_identifier") {
            const parts = ctor.text.split(".");
            className = parts[parts.length - 1] ?? null;
          }
          if (className) {
            calls.push({
              calleeName: className,
              inFunction: currentMethod()?.name ?? null,
              fromContainerType: currentClass()?.name,
              calleeType: className,
              isConstructor: true,
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "class_declaration":
      case "abstract_class_declaration":
      case "class": {
        // The `name` field is missing for anonymous classes (`class { ... }`)
        const nameNode = node.childForFieldName("name");
        const className = nameNode?.text ?? "<anonymous>";
        const bodyNode = node.childForFieldName("body");
        const fields = bodyNode
          ? collectClassFields(bodyNode)
          : new Map<string, string>();

        // Detect constructor parameter properties — they implicitly become
        // class fields too.
        if (bodyNode) {
          for (const member of bodyNode.namedChildren) {
            if (member.type !== "method_definition") continue;
            const memberName =
              member.childForFieldName("name")?.text ?? "";
            if (memberName === "constructor") {
              const paramProps = collectConstructorParamProperties(member);
              for (const [k, v] of paramProps) fields.set(k, v);
            }
          }
        }

        classStack.push({ name: className, fields });
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) visit(child);
        }
        classStack.pop();

        // v0.70: also emit a richer ParsedClass for the
        // Architecture-tab Mermaid generator. Skips anonymous
        // classes (no useful diagram) — they're rare and the
        // diagram doesn't have a name to label them with anyway.
        if (className !== "<anonymous>" && bodyNode) {
          const fullFields = collectFullClassFields(bodyNode);
          // Constructor parameter properties — collected as full
          // ParsedField entries (visibility / readonly preserved).
          for (const member of bodyNode.namedChildren) {
            if (member.type !== "method_definition") continue;
            const memberName =
              member.childForFieldName("name")?.text ?? "";
            if (memberName === "constructor") {
              for (const f of collectConstructorParamFields(member)) {
                fullFields.push(f);
              }
            }
          }
          // Walk the body for method definitions so we can list
          // their names. Full FunctionDef cross-reference happens
          // during cg aggregation (matching containerType + name).
          const methodNames: string[] = [];
          for (const member of bodyNode.namedChildren) {
            if (member.type !== "method_definition") continue;
            const m = member.childForFieldName("name");
            if (m && m.text) methodNames.push(m.text);
          }
          parsedClasses.push({
            name: className,
            startRow: node.startPosition.row,
            endRow: node.endPosition.row,
            fields: fullFields,
            methodNames,
            parentClass: extractParentClass(node),
            implements: extractImplements(node),
            isAbstract: node.type === "abstract_class_declaration",
            isInterface: false,
          });
        }
        return;
      }

      case "interface_declaration": {
        // TypeScript-only. Interfaces have no implementation, so we
        // capture them purely for the Architecture-tab diagram —
        // they're skipped by the type-aware-resolution paths above.
        const nameNode = node.childForFieldName("name");
        const interfaceName = nameNode?.text ?? "<anonymous>";
        if (interfaceName === "<anonymous>") {
          for (const child of node.namedChildren) visit(child);
          return;
        }
        const bodyNode = node.childForFieldName("body");
        const ifaceFields: ParsedField[] = [];
        const ifaceMethods: string[] = [];
        if (bodyNode) {
          for (const member of bodyNode.namedChildren) {
            if (member.type === "property_signature") {
              const propNode = member.childForFieldName("name");
              if (propNode?.type === "property_identifier") {
                const typeNode = member.childForFieldName("type");
                const type = typeNode
                  ? extractTypeFromAnnotation(typeNode) ?? undefined
                  : undefined;
                ifaceFields.push({
                  name: propNode.text,
                  type,
                  visibility: "public",
                  isStatic: false,
                });
              }
            } else if (member.type === "method_signature") {
              const m = member.childForFieldName("name");
              if (m && m.text) ifaceMethods.push(m.text);
            }
          }
        }
        // Interfaces extend other interfaces, not classes — capture
        // the same way for visualisation purposes.
        parsedClasses.push({
          name: interfaceName,
          startRow: node.startPosition.row,
          endRow: node.endPosition.row,
          fields: ifaceFields,
          methodNames: ifaceMethods,
          parentClass: extractParentClass(node),
          implements: [],
          isInterface: true,
          isAbstract: false,
        });
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode?.text ?? "<anon>";
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const locals = collectMethodParams(node);
        methodStack.push({ name: fnName, locals, decisionPoints: 0, tainted: new Map() });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: currentClass()?.name,
          bodyHash: body ? hashSubtree(body) : undefined,
        });
        return;
      }

      case "function_declaration":
      case "generator_function_declaration":
      case "function_expression":
      case "generator_function": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) {
          // Anonymous function/expression. Walk body for nested decisions
          // but don't emit ParsedFunction (no name to record).
          const body = node.childForFieldName("body");
          if (body) for (const child of body.namedChildren) visit(child);
          return;
        }
        const fnName = nameNode.text;
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const locals = collectMethodParams(node);
        methodStack.push({ name: fnName, locals, decisionPoints: 0, tainted: new Map() });
        const body = node.childForFieldName("body");
        if (body) for (const child of body.namedChildren) visit(child);
        const ms = methodStack.pop()!;
        functions.push({
          name: fnName,
          startRow,
          endRow,
          complexity: 1 + ms.decisionPoints,
          containerType: currentClass()?.name,
          bodyHash: body ? hashSubtree(body) : undefined,
        });
        return;
      }

      case "variable_declarator": {
        // const/let with explicit type? With an arrow function value?
        const nameNode = node.childForFieldName("name");
        const typeNode = node.childForFieldName("type"); // type_annotation
        const valueNode = node.childForFieldName("value");

        // 1. Track type if name is a plain identifier and we have either an
        //    annotation or an inferable rhs.
        if (nameNode?.type === "identifier") {
          let typeName: string | null = null;
          if (typeNode) {
            typeName = extractTypeFromAnnotation(typeNode);
          } else if (valueNode) {
            typeName = inferExpressionType(valueNode);
          }
          if (typeName) {
            const m = currentMethod();
            if (m) m.locals.set(nameNode.text, typeName);
          }
          const t = jsTaintOf(valueNode);
          if (t) markJsTainted(nameNode.text, { ...t, via: nameNode.text });
        }

        // 2. Arrow-function or function-expression assigned to a name?
        //    Emit it as a ParsedFunction with the variable's name.
        if (
          nameNode?.type === "identifier" &&
          valueNode &&
          (valueNode.type === "arrow_function" ||
            valueNode.type === "function_expression")
        ) {
          const fnName = nameNode.text;
          const startRow = nameNode.startPosition.row;
          const endRow = valueNode.endPosition.row;
          const params = valueNode.childForFieldName("parameters");
          const locals = new Map<string, string>();
          if (params) {
            for (const p of params.namedChildren) {
              const info = extractParamNameAndType(p);
              if (info && info.type) locals.set(info.name, info.type);
            }
          }
          methodStack.push({ name: fnName, locals, decisionPoints: 0, tainted: new Map() });
          const body = valueNode.childForFieldName("body");
          if (body) {
            // body could be a statement_block or an expression (for arrow
            // functions like `() => 1`). Walk either way.
            if (body.type === "statement_block") {
              for (const child of body.namedChildren) visit(child);
            } else {
              visit(body);
            }
          }
          const ms = methodStack.pop()!;
          functions.push({
            name: fnName,
            startRow,
            endRow,
            complexity: 1 + ms.decisionPoints,
            containerType: currentClass()?.name,
            bodyHash: body ? hashSubtree(body) : undefined,
          });
          return; // already visited the body above
        }

        // 3. Otherwise just walk children for nested calls/decisions
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "for_in_statement":
      case "do_statement":
      case "switch_case":
      case "ternary_expression":
      case "catch_clause":
        countDecisionPoint();
        jsBranchDepth++;
        for (const child of node.namedChildren) visit(child);
        jsBranchDepth--;
        return;

      case "binary_expression": {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||" || op === "??") countDecisionPoint();
        for (const child of node.namedChildren) visit(child);
        return;
      }

      case "assignment_expression": {
        // el.innerHTML = <tainted>  — the value is parsed as HTML.
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (left?.type === "member_expression") {
          const prop = left.childForFieldName("property")?.text;
          if (prop && JS_HTML_PROPERTIES.has(prop)) {
            const t = jsTaintOf(right);
            if (t) emitSink("js-dom-xss", node.startPosition.row, t);
          }
        }
        // Propagate: `x = <tainted>` keeps the flow alive.
        if (left?.type === "identifier") {
          const t = jsTaintOf(right);
          if (t) markJsTainted(left.text, { ...t, via: left.text });
          else if (jsBranchDepth === 0) clearJsTainted(left.text);
        }
        for (const child of node.namedChildren) visit(child);
        return;
      }

      default:
        for (const child of node.namedChildren) visit(child);
    }
  }

  visit(tree.rootNode);

  // Weak-Suite: only test files pay for the extra assertion-quality walk. Must
  // read nodes BEFORE tree.delete() below.
  const testMeta = looksLikeJsTestFile(file.rel)
    ? extractTestMeta(tree.rootNode)
    : undefined;

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
    ...(testMeta ? { testMeta } : {}),
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

export const javascriptPlugin = {
  name: PLUGIN_NAME,
  extensions: EXTENSIONS,

  async load() {
    if (langs.javascript && langs.typescript && langs.tsx) return;
    const [js, ts, tsx] = await Promise.all([
      loadBuiltinGrammar("tree-sitter-javascript"),
      loadBuiltinGrammar("tree-sitter-typescript"),
      loadBuiltinGrammar("tree-sitter-tsx"),
    ]);
    langs.javascript = js;
    langs.typescript = ts;
    langs.tsx = tsx;
  },

  async prepareForRepo(root, ix) {
    // Load both in parallel — neither blocks the other and both are
    // small fs ops next to the parse pipeline that follows.
    const [tsPathMappings, workspaces] = await Promise.all([
      loadTsconfigPaths(root),
      loadWorkspacePackages(root),
    ]);
    const ctx: JsResolverContext = {};
    if (tsPathMappings) ctx.tsPathMappings = tsPathMappings;
    if (workspaces.size > 0) ctx.workspaces = workspaces;
    if (ctx.tsPathMappings || ctx.workspaces) {
      ix.extras.set(PLUGIN_NAME, ctx);
    }
  },

  languageFor(ext) {
    const lang = langs[slotFor(ext)];
    if (!lang) {
      throw new Error(
        `javascript plugin not loaded — call plugin.load() before languageFor()`
      );
    }
    return lang;
  },

  queriesFor(_ext): PluginQueries {
    // All extensions share the same queries — node names are consistent
    // across the JS / TS / TSX grammar family. Kept defined for any caller
    // that prefers the standard pipeline; the orchestrator routes through
    // parseDirect since v0.17.
    return QUERIES;
  },

  parseDirect: parseJsDirect,

  resolveImport: resolveJsImport,

  // Import resolution uses only the path set + a serializable context
  // (tsconfig paths + workspace map), never another file's content, so the
  // Shadow-Graph patcher can re-resolve JS/TS imports from a stub index and
  // produce a byte-exact incremental graph. See fastPatchable in the contract.
  fastPatchable: true,
} satisfies CodeAnalysisPlugin;
