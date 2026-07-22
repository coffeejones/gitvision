// Shared types for the codeAnalysis plugin architecture.
//
// Each language implements CodeAnalysisPlugin. The orchestrator runs the same
// pipeline against every plugin whose extensions are present:
//   walk → per-file: pick parser (tree-sitter OR direct) → extract symbols
//   → cross-file resolution (plugin-supplied) → CodeGraph aggregation.
//
// Adding a new language = one file in ./plugins/ implementing CodeAnalysisPlugin.
// The orchestrator must never contain language-specific branches.

import type { Language } from "web-tree-sitter";

/** Canonical capture names the orchestrator understands. Query strings must
 *  use exactly these names on the nodes the orchestrator will read from the
 *  match; anything else is ignored. Keeps the plugin-to-orchestrator contract
 *  data-driven instead of a callback for every capture kind. */
export type Capture = "spec" | "name" | "callee" | "body" | "params";

/** A source file with enough metadata to parse + locate it in the repo. */
export interface SourceFile {
  /** Path relative to repo root (posix-style), e.g. "src/api/foo.ts". */
  rel: string;
  /** Lowercase extension without the dot, e.g. "ts". */
  ext: string;
  content: string;
}

/** Lookup maps provided to plugins during cross-file resolution. */
export interface FileIndex {
  byPath: Map<string, SourceFile>;
  byExt: Map<string, SourceFile[]>;
  /** Per-plugin opaque storage keyed by plugin.name. Plugins that need
   *  per-repo config (tsconfig paths, go.mod module path, etc.) populate
   *  this in their `prepareForRepo` hook and read it in `resolveImport`.
   *  Other plugins ignore unrelated keys. Keeps language-specific data
   *  out of orchestrator code. */
  extras: Map<string, unknown>;
}

/** Tree-sitter query sources (S-expressions). The orchestrator compiles each
 *  non-null entry against the plugin's Language once per analysis run. Leave
 *  a category null to skip it for this plugin. */
export interface PluginQueries {
  imports?: string;
  functionDefs?: string;
  callSites?: string;
  decisionPoints?: string;
}

// ------------------- Per-file output (returned by parseFile) -------------------

/** A module-level edge originating from one file, kept loose so regex-based
 *  plugins (which already know the kind from their parser) and tree-sitter
 *  plugins (which always emit "import") use the same shape. */
export type ImportKind = "import" | "extends" | "implements" | "renders";

export interface ParsedImport {
  /** The literal spec as written in source. Useful for unresolvedImports stats
   *  and external-package counts. */
  rawSpec: string;
  /** Repo-rel path of the resolved target file, or null if external/unresolvable. */
  resolvedPath: string | null;
  /** Edge kind. Defaults to "import" for plugins that don't specify. */
  kind?: ImportKind;
}

export interface ParsedFunction {
  name: string;
  startRow: number;
  endRow: number;
  complexity: number;
  /** When the plugin can identify the class/struct/etc. this function
   *  belongs to. Java methods know their class; Go methods know their
   *  receiver type; Python methods know their class. Top-level / module-
   *  scope functions leave this undefined. Drives type-aware call
   *  resolution in buildCodeGraph (Phase 5+). */
  containerType?: string;
  /** Structural hash of the function body's AST subtree (v0.30+).
   *  Identifier names + literal values are NOT hashed; only node types
   *  and operator tokens are. Two functions with the same shape but
   *  different variable names produce identical hashes — that's the
   *  basis for the duplicate-detection panel in the Code tab. Plugins
   *  that don't yet compute hashes leave this undefined; the duplicate
   *  detector skips functions without a hash. */
  bodyHash?: string;
}

export interface ParsedCall {
  calleeName: string;
  /** Name of the enclosing function/method. null for module-scope calls. */
  inFunction: string | null;
  /** Container (class/struct/etc.) of the enclosing function, when the plugin
   *  can identify it — mirrors FunctionDef.containerType, stamped from the same
   *  live class scope. Lets the graph builder give CallEdge an EXACT caller
   *  container (CallEdge.fromContainerType), so the caller side of the function
   *  blast radius is as precise as the callee side. Optional: module-scope /
   *  top-level callers and plugins that don't track class scope leave it unset. */
  fromContainerType?: string;
  /** When the plugin can statically infer the type of the call's receiver.
   *  E.g. for `validatePassword.validate(...)`, this is "ValidatePassword"
   *  if `validatePassword` was declared as that type in scope. Drives
   *  type-aware disambiguation between same-named methods in different
   *  classes (Phase 5+). Undefined when not inferable (dynamic types,
   *  complex expressions, etc.). */
  calleeType?: string;
  /** True when the original call had a receiver (`obj.method()`,
   *  `Foo.method()`, `self.method()`) regardless of whether we could
   *  infer its type. False or undefined for bare calls (`helper()`,
   *  top-level functions, module-scope). Lets pickCallTarget refuse
   *  single-candidate-match for receiver-having calls whose type is
   *  unknown — that's the dynamic-language pattern that caused 76
   *  spurious lib->spec edges in rspec-core (v0.23). Bare calls keep
   *  the single-candidate fallback because the alternative (always
   *  unresolved bare calls) loses too much real signal. */
  hasReceiver?: boolean;
}

/** One test case (an `it`/`test` block) with its assertion-quality tally.
 *  LANGUAGE-NEUTRAL: a plugin fills these counts from its own assertion idioms
 *  (JS `expect`/`assert`, Python `assert`/`pytest.raises`, …). Nothing
 *  downstream — the aggregate compute, the signal, the UI — knows any language.
 *  This is the Weak-Suite contract (Arc 1). */
export interface TestCaseMeta {
  /** The test's description (first string arg), or "" when anonymous. */
  name: string;
  /** 1-based line the test case opens on, for evidence citations. */
  line: number;
  /** Assertion statements found in the case body. */
  assertions: number;
  /** Of those, how many are trivial "smoke" oracles — existence / truthiness /
   *  did-not-throw checks that verify almost nothing. */
  trivialAssertions: number;
  /** True when the case has at least one meaningful (value-checking) assertion.
   *  A case with assertions but no meaningful oracle is "smoke-only". */
  hasMeaningfulOracle: boolean;
}

/** Per-test-file assertion-quality metadata (Weak-Suite). Emitted only for
 *  files a plugin recognises as containing test cases; absent otherwise. */
export interface TestFileMeta {
  /** Test cases found in the file, in source order. */
  cases: TestCaseMeta[];
  /** Distinct trivial-oracle idiom names encountered (e.g. "toBeDefined"),
   *  carried verbatim as evidence so the methodology is auditable ("publish
   *  the math"). Language-specific STRINGS, but treated as opaque data. */
  trivialOracleNames: string[];
}

export interface ParsedFile {
  rel: string;
  imports: ParsedImport[];
  functions: ParsedFunction[];
  calls: ParsedCall[];
  /** Total decision points across the whole file + 1. */
  fileComplexity: number;
  parseError: boolean;
  /** Class / interface / struct definitions found in this file
   *  (v0.70+). Used by the Architecture tab to render class
   *  diagrams. Optional so plugins can adopt incrementally — JS/TS
   *  ships first; other languages emit empty arrays until they wire
   *  up class extraction in their parseDirect / query handlers. */
  classes?: ParsedClass[];
  /** Per-test-file assertion-quality metadata (Weak-Suite, Arc 1). Present only
   *  when the plugin recognised test cases in this file; JS/TS ships first,
   *  other languages fill the same shape as they adopt. Optional for
   *  backward-compat. */
  testMeta?: TestFileMeta;
}

/** Per-file class definition emitted by language plugins.
 *  Mirrors ClassDef on the cross-file CodeGraph but lives one
 *  level closer to the parser — methods are referenced by name +
 *  startRow only, the full FunctionDef cross-reference happens
 *  during codeGraph aggregation. */
export interface ParsedClass {
  name: string;
  startRow: number;
  endRow: number;
  fields: ParsedField[];
  /** Names of methods declared on this class. The orchestrator
   *  resolves these to full FunctionDef entries by matching
   *  containerType + name during cg aggregation. */
  methodNames: string[];
  /** Direct parent class name (single-inheritance languages) or
   *  the first listed when the language allows multiple. */
  parentClass?: string;
  /** Names of interfaces / protocols / mixins declared via
   *  `implements`, `:`, `<:`, etc. depending on language. Empty
   *  array for languages without an explicit interface concept. */
  implements?: string[];
  /** True when the source declared this as `interface` / `protocol`
   *  / `trait` rather than `class`. Drives the Mermaid stereotype
   *  in the diagram renderer (`<<interface>>`). */
  isInterface?: boolean;
  /** True when the class itself is declared abstract (Java
   *  `abstract class`, TypeScript `abstract class`). */
  isAbstract?: boolean;
  /** True when this entry represents an enum declaration (Java enum,
   *  C# enum, PHP 8.1+ enum). The diagram renderer surfaces these
   *  with the Mermaid `<<enumeration>>` stereotype and lists their
   *  values via {@link enumValues}. v0.71+. */
  isEnum?: boolean;
  /** When isEnum is true, the literal constant names declared inside
   *  the enum body (`RED`, `GREEN`, `BLUE` for `enum Color`). Order
   *  preserved from source. Empty when the enum body is empty or the
   *  language doesn't carry value names. */
  enumValues?: string[];
}

/** A single field / property declaration on a class. Optional
 *  fields stay undefined when the source language doesn't carry
 *  the information (Python without PEP 526 hints has no type;
 *  JavaScript has no real visibility). */
export interface ParsedField {
  name: string;
  /** Source-spelled type ("string", "User[]", "Map<K,V>"). The
   *  diagram renderer prints it verbatim — we don't try to
   *  normalise across languages. Undefined for dynamic-language
   *  fields without annotations. */
  type?: string;
  visibility: ClassMemberVisibility;
  isStatic: boolean;
  /** True for `readonly` / `final` / `const` fields. Surfaced as
   *  a stereotype in the Mermaid output. */
  isReadonly?: boolean;
}

/** Member visibility, normalised across languages. Languages
 *  without explicit modifiers (JS, Ruby) map case / underscore
 *  conventions onto these values: `_foo` → "private", `foo` →
 *  "public", etc. */
export type ClassMemberVisibility =
  | "public"
  | "private"
  | "protected"
  | "internal";

// ------------------- Plugin contract -------------------

/** Contract every language plugin implements. Tree-sitter plugins must define
 *  `languageFor` + `queriesFor`. Regex / non-AST plugins must define
 *  `parseDirect` instead. Setting both is supported (parseDirect wins). */
export interface CodeAnalysisPlugin {
  /** Stable identifier, also used in CodeGraph.stats.byPlugin. */
  readonly name: string;
  /** Extensions this plugin handles (no dot, lowercase). */
  readonly extensions: readonly string[];

  /** Load any per-process resources (e.g. tree-sitter grammars). Called once
   *  per analysis run. Idempotent — safe to call repeatedly. Plugins with no
   *  process-level setup return immediately. */
  load(): Promise<void>;

  /** Optional per-repo setup. Called once per `analyzeDirectory` run, after
   *  the FileIndex is built but before any parseFile call. Use this to read
   *  language-specific config files (tsconfig.json, package.json workspaces,
   *  go.mod, ...) and stash them on `ix.extras` keyed by the plugin's name. */
  prepareForRepo?(root: string, ix: FileIndex): Promise<void>;

  // ---- Tree-sitter path (one of these two paths must be implemented) ----

  /** Pick the Language to use for a given extension. Tree-sitter plugins only. */
  languageFor?(ext: string): Language;

  /** Return the query sources to compile for this extension. Tree-sitter
   *  plugins only. */
  queriesFor?(ext: string): PluginQueries;

  // ---- Direct path (alternative for regex / non-AST plugins) ----

  /** Parse a single file directly without going through tree-sitter. Used by
   *  the regex-fallback plugin (and any future non-AST plugins). When defined,
   *  the orchestrator calls this instead of running tree-sitter queries. */
  parseDirect?(file: SourceFile, ix: FileIndex): ParsedFile;

  // ---- Resolution (always required) ----

  /** Resolve an import-spec captured by the `imports` query (or by parseDirect)
   *  to a repo-relative file path. Return null for external / unresolvable
   *  specs. */
  resolveImport(spec: string, fromPath: string, ix: FileIndex): string | null;

  /** True when this plugin's cross-file resolution depends ONLY on the path set
   *  + a serializable resolver context (not on other files' contents), so the
   *  Shadow-Graph patcher can re-resolve its imports from a stub index without
   *  the repo on disk — enabling a byte-exact incremental patch. JS/TS sets this.
   *  Plugins whose extras are built from other files' contents (Java/C#/PHP/Ruby)
   *  or baked in prepareForRepo (kt/html/css) leave it false; the patcher freezes
   *  their cross-file edges at base and declares the approximation. */
  readonly fastPatchable?: boolean;
}

// ------------------- CodeGraph (cross-file aggregate) -------------------
//
// Phase 4 will lift this onto AnalysisSnapshot.codeGraph as an optional field;
// for now it's the orchestrator's return value, consumed by the dev CLI and
// the debug API endpoint.

/** A function or method definition discovered in some file. */
export interface FunctionDef {
  filePath: string;
  name: string;
  startRow: number;
  endRow: number;
  complexity: number;
  /** Mirrors ParsedFunction.containerType. The class/struct/etc. this
   *  function belongs to, when known. Used for type-aware call resolution
   *  in pickCallTarget. */
  containerType?: string;
  /** Mirrors ParsedFunction.bodyHash (v0.30+). 16 hex chars from
   *  FNV-1a 64. Used by duplicates.ts to find structurally identical
   *  functions across the codebase. */
  bodyHash?: string;
}

/** A call edge — function X in file A calls callable Y, possibly resolved to
 *  function Z in file B. Both endpoints are recorded for blast-radius queries
 *  in Phase 4. */
export interface CallEdge {
  fromFile: string;
  /** Enclosing function in fromFile. null for module-scope calls. */
  fromFunction: string | null;
  /** Simple name of the callable as captured. */
  calleeName: string;
  /** Repo-rel path of the file defining the callee, when resolvable. */
  toFile: string | null;
  /** Function name in toFile, when resolvable. */
  toFunction: string | null;
  /** Container (class/struct/etc.) of the resolved target, when known
   *  (v0.28+). Lets the function-level blast radius distinguish between
   *  same-named overloads in the same file (e.g. `Blueprint.__init__`
   *  vs `BlueprintSetupState.__init__` in flask/sansio/blueprints.py).
   *  Without this, both __init__ entries collapse to one BFS node and
   *  produce identical results — the v0.20 chip-dedup workaround.
   *  Top-level / module-scope target functions leave this undefined. */
  toContainerType?: string;
  /** Container (class/struct/etc.) of the CALLER's enclosing function
   *  (fromFunction), when the plugin can identify it (v0.44+). The source-side
   *  mirror of toContainerType: lets the function blast radius pick the EXACT
   *  caller among same-named methods across sibling classes in one file,
   *  instead of the name-only last-wins guess it fell back to before. Supplied
   *  by the plugin from live class scope (JS/TS first); absent for plugins that
   *  don't yet emit it and for the regex-fallback languages (no call edges at
   *  all). Optional so old snapshots on disk keep deserializing. */
  fromContainerType?: string;
}

/** A module-level edge between files. */
export interface ImportEdge {
  from: string;
  to: string;
  kind: ImportKind;
}

/** Per-plugin contribution stats — useful for the debug API to show "regex
 *  fallback handled 287 Java/Python files", etc. */
export interface PluginStats {
  files: number;
  functions: number;
  calls: number;
  imports: number;
}

/** A class / interface / struct definition aggregated to the
 *  CodeGraph level. Mirrors ParsedClass from the parser layer but
 *  resolves method names to full FunctionDef entries so downstream
 *  consumers (Architecture-tab Mermaid generator, future pattern-
 *  detection rules) get rich method signatures without re-walking
 *  cg.functions. v0.70+. */
export interface ClassDef {
  name: string;
  filePath: string;
  startRow: number;
  endRow: number;
  fields: ParsedField[];
  /** Methods that belong to this class (resolved by matching
   *  containerType + name during aggregation). Always references
   *  the same FunctionDef instances as cg.functions, so blast-
   *  radius / complexity data is consistent. */
  methods: FunctionDef[];
  parentClass?: string;
  implements?: string[];
  isInterface?: boolean;
  isAbstract?: boolean;
  /** v0.71: enum support. Mirror of the same fields on ParsedClass. */
  isEnum?: boolean;
  enumValues?: string[];
}

/** The full output of a code-analysis pass. Designed to live optionally on
 *  AnalysisSnapshot.codeGraph (Phase 4); old snapshots without this field
 *  continue to render normally. */
export interface CodeGraph {
  functions: FunctionDef[];
  /** Resolved + unresolved call edges. Filter on toFile != null for the
   *  resolved subset. */
  calls: CallEdge[];
  imports: ImportEdge[];
  /** Aggregate complexity per file (sum of decision points + 1). */
  fileComplexity: Record<string, number>;
  /** Stable content fingerprint per file (djb2 of the raw source). Optional so
   *  legacy snapshots stay valid; lets change-detection see edits that the
   *  function/complexity signature misses — notably regex-fallback languages
   *  (.kt/.html/.css) that emit no functions and constant complexity. */
  contentHashes?: Record<string, string>;
  /** Files we parsed grouped by extension — helps debug coverage. */
  filesByExt: Record<string, number>;
  /** Per-plugin breakdown for stats and "fallback in use" indicators. */
  byPlugin: Record<string, PluginStats>;
  /** Class / interface definitions across all files (v0.70+).
   *  Optional so legacy snapshots without class extraction render
   *  unchanged; the Architecture tab shows an empty-state when
   *  this field is missing or empty. */
  classes?: ClassDef[];
  /** Per-test-file assertion-quality metadata (Weak-Suite, Arc 1), one entry
   *  per test file a plugin classified. Raw material for computeWeakSuite;
   *  optional/absent on legacy graphs and non-test-bearing repos. */
  testFiles?: TestFileGraphEntry[];
  /** Truncation reason if any cap was hit. */
  truncated?: string;
}

/** A test file's assertion-quality metadata, path-tagged for the graph layer. */
export interface TestFileGraphEntry extends TestFileMeta {
  file: string;
}
