// Cross-file aggregator. Takes per-file ParsedFile records (already produced
// by parseFile + plugin pipeline) and builds the unified CodeGraph that lives
// on AnalysisSnapshot.codeGraph.
//
// Three pieces of cross-file resolution happen here:
//   1. Call → callee disambiguation (which function, in which file, does
//      `foo()` refer to?). Uses file-level import knowledge to disambiguate
//      between same-named functions in different files.
//   2. Route declaration → handler (v0.82+). A routing TABLE names its handler
//      in another file, so only this layer can resolve it. See
//      applyRouteDeclarations.
//   3. Per-plugin stats roll-up — useful for the debug API to surface which
//      plugin produced what.

import type {
  CallEdge,
  ClassDef,
  CodeGraph,
  FunctionDef,
  ImportEdge,
  ParsedClass,
  ParsedFile,
  PluginStats,
  RouteDeclaration,
  SinkGraphEntry,
  TestFileGraphEntry,
} from "./types";
import { isTestFile } from "./testCoverage";

export interface BuildCodeGraphInput {
  parsedFiles: ParsedFile[];
  /** Repo-rel path → plugin name that parsed it. Drives byPlugin stats. */
  pluginByFile: Map<string, string>;
  /** Truncation reason if any cap was hit. */
  truncated?: string;
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
/** "introduction/views.py" → "views". The module name a routing table — or a
 *  module-qualified call like `views.home()` — would have written to reach it. */
const moduleOf = (p: string) => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

/** The name you import a file BY. For `pkg/__init__.py` that is `pkg`, not
 *  `__init__` — a package is referred to by its directory. */
const importableNameOf = (p: string) => {
  const base = moduleOf(p);
  if (base !== "__init__") return base;
  const dir = p.slice(0, p.lastIndexOf("/"));
  return dir.slice(dir.lastIndexOf("/") + 1);
};

/** Stamp `entryPoint` onto the handlers named by routing tables.
 *
 *  A table (`urls.py`) names its handler as `views.home` — a module and a
 *  function, in a file the per-file parser never saw. Resolution narrows in
 *  three steps, each of which can only REMOVE candidates:
 *
 *    1. functions with that name
 *    2. if the table qualified the module, files whose module name matches
 *    3. files in the same directory as the table (a Django app is one folder)
 *
 *  If more than one candidate survives, we stamp NOTHING. An entry point is
 *  evidence that untrusted input reaches a function; guessing which of two
 *  same-named functions it reaches would invent reachability, and reachability
 *  is what the security layer suppresses findings with.
 *
 *  Decorators win over tables: a handler that declared its own route said so
 *  more precisely than a table pointing at it. */
/** Methods a web framework calls on a registered view class, without anything
 *  in the repo calling them. HTTP verbs and `dispatch` for Django's class-based
 *  views; the action names for DRF viewsets.
 *
 *  Deliberately bounded. Django also invokes lifecycle hooks — `form_valid`,
 *  `get_queryset`, `get_context_data` — but it does so from ITS base classes,
 *  which are not in the repo, so we cannot show a path and will not claim one.
 *  Those land in `unknown`, which is the honest answer rather than a hidden
 *  one. Where a repo defines its own base class (NetBox does), the graph
 *  connects the chain on its own and no special case is needed. */
const FRAMEWORK_INVOKED_METHODS: ReadonlySet<string> = new Set([
  // Django View
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
  "dispatch",
  // DRF ViewSet actions
  "list",
  "create",
  "retrieve",
  "update",
  "partial_update",
  "destroy",
]);

/** How far up an inheritance chain to look for the handler methods. Six is far
 *  past any real view hierarchy and stops a cycle dead. */
const MAX_BASE_CLASS_HOPS = 6;

function applyRouteDeclarations(
  parsedFiles: ParsedFile[],
  funcsByName: Map<string, FunctionDef[]>,
  methodsByContainer: Map<string, FunctionDef[]>
): void {
  // Deterministic: a handler wired to several routes keeps the smallest one, so
  // the result never depends on file iteration order.
  const claimed = new Map<FunctionDef, RouteDeclaration>();

  /** Narrow a candidate set the same way for functions and classes: module
   *  qualifier first, then the table's own directory. Both steps can only
   *  remove. */
  const narrow = <T extends { filePath: string }>(
    candidates: T[],
    decl: RouteDeclaration,
    fromFile: string
  ): T[] => {
    let out = candidates;
    if (decl.targetModule) {
      const byModule = out.filter((f) => moduleOf(f.filePath) === decl.targetModule);
      if (byModule.length > 0) out = byModule;
    }
    if (new Set(out.map((f) => f.filePath)).size > 1) {
      const sameDir = out.filter((f) => dirOf(f.filePath) === dirOf(fromFile));
      if (sameDir.length > 0) out = sameDir;
    }
    return out;
  };

  // Class name → where it is defined and what it extends. Registered view
  // classes are routinely pure configuration —
  //   class WirelessLANViewSet(NetBoxModelViewSet):
  //       queryset = WirelessLAN.objects.all()
  // — with the handler methods on a base class the repo also defines. Marking
  // only the leaf finds nothing for 139 of NetBox's 167 registrations.
  const classesByName = new Map<
    string,
    { filePath: string; name: string; bases: string[] }[]
  >();
  for (const f of parsedFiles) {
    for (const c of f.classes ?? []) {
      const arr = classesByName.get(c.name) ?? [];
      // baseClasses when the plugin emits it (Python), otherwise reconstruct
      // from the older pair — which gives Java/C#/PHP the same multi-base walk
      // for free, since their interfaces land in `implements`.
      const bases =
        c.baseClasses ??
        [c.parentClass, ...(c.implements ?? [])].filter((n): n is string => !!n);
      arr.push({ filePath: f.rel, name: c.name, bases });
      classesByName.set(c.name, arr);
    }
  }

  /** The methods a registered class exposes to the framework — its own if it
   *  defines any, otherwise the nearest ancestor's.
   *
   *  Sound because inheritance is: if a registered viewset inherits `list()`
   *  from a base the repo defines, that `list()` really is externally
   *  invocable. It gets marked once and shared by every subclass, which
   *  matches how the code actually runs.
   *
   *  BREADTH-FIRST over ALL bases, not up a single chain. Python view
   *  hierarchies put mixins first —
   *  `class NetBoxModelViewSet(ETagMixin, mixins.CustomFieldsMixin, ModelViewSet)`
   *  — so following only the head walks into the mixin and never reaches the
   *  class defining the handlers. Source order approximates Python's MRO,
   *  which is what its own linearisation starts from. */
  const frameworkMethodsFor = (
    startFile: string,
    startName: string
  ): FunctionDef[] => {
    let frontier: { filePath: string; name: string }[] = [
      { filePath: startFile, name: startName },
    ];
    const seen = new Set<string>();
    for (let hop = 0; hop < MAX_BASE_CLASS_HOPS && frontier.length > 0; hop++) {
      const found: FunctionDef[] = [];
      const next: { filePath: string; name: string }[] = [];
      for (const cls of frontier) {
        const key = `${cls.filePath}\u001F${cls.name}`;
        if (seen.has(key)) continue; // diamond or cycle
        seen.add(key);
        for (const m of methodsByContainer.get(cls.name) ?? []) {
          if (m.filePath === cls.filePath && FRAMEWORK_INVOKED_METHODS.has(m.name)) {
            found.push(m);
          }
        }
        const self = (classesByName.get(cls.name) ?? []).find(
          (c) => c.filePath === cls.filePath
        );
        for (const baseName of self?.bases ?? []) {
          // Follow a base only when exactly one class in the repo carries that
          // name - the same decline-on-ambiguity rule as everywhere else.
          const defs = classesByName.get(baseName) ?? [];
          if (defs.length !== 1) continue;
          next.push({ filePath: defs[0].filePath, name: baseName });
        }
      }
      // Stop at the first level that defines handlers: going deeper would
      // collect a grandparent implementation the nearer class overrides.
      if (found.length > 0) return found;
      frontier = next;
    }
    return [];
  };

  for (const file of parsedFiles) {
    for (const decl of file.routes ?? []) {
      // A class-based view: the entry points are the framework-invoked methods
      // ON the class, not the class itself. Nothing in the repo calls them, so
      // without this they look like dead code — which is exactly how 84 NetBox
      // routes and 139 DRF viewsets went missing.
      if (decl.targetIsClass) {
        // Resolve the CLASS first — it may define no methods of its own.
        const classes = narrow(
          classesByName.get(decl.targetName) ?? [],
          decl,
          file.rel
        );
        if (classes.length !== 1) continue; // absent or ambiguous ⇒ decline
        for (const m of frameworkMethodsFor(classes[0].filePath, classes[0].name)) {
          if (m.entryPoint) continue;
          const prev = claimed.get(m);
          if (!prev || decl.route < prev.route) claimed.set(m, decl);
        }
        continue;
      }

      let candidates = funcsByName.get(decl.targetName) ?? [];
      if (candidates.length === 0) continue;

      if (decl.targetModule) {
        const byModule = candidates.filter(
          (f) => moduleOf(f.filePath) === decl.targetModule
        );
        if (byModule.length > 0) candidates = byModule;
      }
      if (candidates.length > 1) {
        const sameDir = candidates.filter(
          (f) => dirOf(f.filePath) === dirOf(file.rel)
        );
        if (sameDir.length > 0) candidates = sameDir;
      }
      if (candidates.length !== 1) continue; // ambiguous → decline

      const target = candidates[0];
      if (target.entryPoint) continue; // a decorator already said it better
      const prev = claimed.get(target);
      if (!prev || decl.route < prev.route) claimed.set(target, decl);
    }
  }

  for (const [target, decl] of claimed) {
    target.entryPoint = {
      kind: "http-route",
      route: decl.route,
      via: decl.via,
      ...(decl.methods ? { methods: decl.methods } : {}),
    };
  }
}

export function buildCodeGraph(input: BuildCodeGraphInput): CodeGraph {
  const { parsedFiles, pluginByFile, truncated } = input;

  // 1. Global function index for call resolution. Same-named functions in
  //    different files are common, so we keep the full list per name and
  //    resolve disambiguation later via import context + containerType.
  const funcsByName = new Map<string, FunctionDef[]>();
  /** Class name → its methods. Lets a routing table that names a CLASS reach
   *  the methods the framework invokes on it. */
  const methodsByContainer = new Map<string, FunctionDef[]>();
  const functions: FunctionDef[] = [];
  for (const f of parsedFiles) {
    for (const fn of f.functions) {
      const def: FunctionDef = {
        filePath: f.rel,
        name: fn.name,
        startRow: fn.startRow,
        endRow: fn.endRow,
        complexity: fn.complexity,
        containerType: fn.containerType,
        bodyHash: fn.bodyHash,
        entryPoint: fn.entryPoint,
        params: fn.params,
      };
      functions.push(def);
      const arr = funcsByName.get(fn.name) ?? [];
      arr.push(def);
      funcsByName.set(fn.name, arr);
      if (def.containerType) {
        const methods = methodsByContainer.get(def.containerType) ?? [];
        methods.push(def);
        methodsByContainer.set(def.containerType, methods);
      }
    }
  }

  applyRouteDeclarations(parsedFiles, funcsByName, methodsByContainer);

  // 2. Per-file resolved-import lookup, used for call disambiguation. Set of
  //    target-file paths the calling file imports (any kind: import / extends
  //    / implements / renders).
  const importsByFile = new Map<string, Set<string>>();
  for (const f of parsedFiles) {
    const set = new Set<string>();
    for (const i of f.imports) {
      if (i.resolvedPath) set.add(i.resolvedPath);
    }
    importsByFile.set(f.rel, set);
  }

  // 2b. Where a name that a file EXPOSES actually comes from.
  //
  //   src/flask/__init__.py:  from .blueprints import Blueprint as Blueprint
  //
  // A caller writes `import flask` then `flask.Blueprint(...)`. Every
  // path-based rule stops at the package root, because blueprints.py is not
  // the file the caller imported and is not named after what they typed.
  // Measured on Flask: 1207 of 1637 unresolved test calls name a function that
  // exists in the graph and is reached only through a re-export like this.
  const symbolOrigin = new Map<string, Map<string, string>>();
  for (const f of parsedFiles) {
    for (const i of f.imports) {
      if (!i.resolvedPath || !i.symbols?.length) continue;
      let m = symbolOrigin.get(f.rel);
      if (!m) { m = new Map(); symbolOrigin.set(f.rel, m); }
      for (const sym of i.symbols) m.set(sym, i.resolvedPath);
    }
  }

  // 3. Resolve each call, producing a CallEdge whose toFile/toFunction is
  //    populated when we can determine the target unambiguously. When the
  //    plugin gave us a calleeType (Java's type-aware extractor in v0.15),
  //    we prefer candidates whose containerType matches — that's the
  //    deterministic answer when receiver type is known.
  //    toContainerType (v0.28) carries the resolved target's container so
  //    function-level blast radius can distinguish same-named overloads.
  const calls: CallEdge[] = [];
  for (const f of parsedFiles) {
    for (const c of f.calls) {
      // A constructor call names a CLASS, but a constructor is indexed as a
      // function named "constructor" whose containerType is that class — so a
      // by-name lookup for `Foo` finds nothing (and, when some unrelated
      // top-level `Foo` exists, finds the wrong thing). Look it up the way it
      // is actually stored, and fall back to the plain by-name candidates for
      // ES5-style constructor functions, where `new Foo()` really does target
      // `function Foo()`.
      let candidates = funcsByName.get(c.calleeName) ?? [];
      if (c.isConstructor) {
        let ctors = (funcsByName.get("constructor") ?? []).filter(
          (f) => f.containerType === c.calleeName
        );
        // Class names repeat across a codebase far more than function names do
        // — zod defines the same class in its v3 and v4 packages — and matching
        // on containerType alone is a global name match with no evidence behind
        // it. Measured: resolving constructors by name alone added 104 edges to
        // zod of which 84 were ones the import graph could not justify. So
        // require the same proof the rest of the resolver requires: the class
        // must be defined in this file or in a file this one imports.
        if (ctors.length > 1 || (ctors.length === 1 && ctors[0].filePath !== f.rel)) {
          const imported = importsByFile.get(f.rel);
          ctors = ctors.filter(
            (t) => t.filePath === f.rel || imported?.has(t.filePath)
          );
        }
        if (ctors.length === 1) candidates = ctors;
      }

      // Languages that do not mark constructor calls. Python writes
      // `flask.Blueprint(...)` with no `new`, so isConstructor is never set and
      // a by-name lookup finds nothing — `Blueprint` is a containerType, not a
      // function name. Fall back to the constructor stored under the language's
      // own convention, and only when the plain lookup found nothing at all, so
      // this can never outrank a real function of the same name.
      if (candidates.length === 0) {
        let byContainer = [
          ...(funcsByName.get("__init__") ?? []),
          ...(funcsByName.get("constructor") ?? []),
        ].filter((t) => t.containerType === c.calleeName);
        // The SAME proof the flagged-constructor path demands, and for the same
        // measured reason: matching a class by name alone added 104 edges to
        // zod of which 84 the import graph could not justify. A class defined
        // here, imported here, or re-exported by something imported here.
        if (byContainer.length > 0) {
          const imported = importsByFile.get(f.rel);
          const viaReExport = new Set<string>();
          if (imported) {
            for (const p of imported) {
              const origin = symbolOrigin.get(p)?.get(c.calleeName);
              if (origin) viaReExport.add(origin);
            }
          }
          byContainer = byContainer.filter(
            (t) =>
              t.filePath === f.rel ||
              imported?.has(t.filePath) ||
              viaReExport.has(t.filePath),
          );
          if (byContainer.length === 1) candidates = byContainer;
        }
      }
      const target = pickCallTarget(
        f.rel,
        c.calleeType,
        c.hasReceiver ?? false,
        candidates,
        importsByFile,
        c.calleeName,
        symbolOrigin
      );
      calls.push({
        fromFile: f.rel,
        fromFunction: c.inFunction,
        // Exact caller container from the plugin's class scope — carried
        // opaquely, never derived here (a name-only lookup would reproduce the
        // ambiguity we're removing). Undefined for plugins that don't emit it.
        fromContainerType: c.fromContainerType,
        calleeName: c.calleeName,
        toFile: target?.filePath ?? null,
        toFunction: target?.name ?? null,
        toContainerType: target?.containerType,
        // Receiver evidence, carried opaquely for the resolution metric — an
        // unresolved call through an untyped receiver is not evidence that we
        // failed at our own code. Omitted when absent so snapshots stay lean.
        ...(c.hasReceiver ? { hasReceiver: true } : {}),
        ...(c.calleeType ? { calleeType: c.calleeType } : {}),
        ...(c.taintedArgs ? { taintedArgs: c.taintedArgs } : {}),
      });
    }
  }

  // 4. Imports: deduplicated, resolved edges only. Self-imports are dropped
  //    (defensive — should not happen in normal source).
  const imports: ImportEdge[] = [];
  const importKey = new Set<string>();
  for (const f of parsedFiles) {
    for (const i of f.imports) {
      if (!i.resolvedPath || i.resolvedPath === f.rel) continue;
      const kind = i.kind ?? "import";
      const k = `${kind}|${f.rel}|${i.resolvedPath}`;
      if (importKey.has(k)) continue;
      importKey.add(k);
      imports.push({ from: f.rel, to: i.resolvedPath, kind });
    }
  }

  // 5. Per-file complexity + filesByExt for quick UI summaries
  const fileComplexity: Record<string, number> = {};
  const filesByExt: Record<string, number> = {};
  for (const f of parsedFiles) {
    fileComplexity[f.rel] = f.fileComplexity;
    const ext = f.rel.includes(".")
      ? f.rel.slice(f.rel.lastIndexOf(".") + 1)
      : "";
    filesByExt[ext] = (filesByExt[ext] ?? 0) + 1;
  }

  // 6. Per-plugin stats
  const byPlugin: Record<string, PluginStats> = {};
  for (const f of parsedFiles) {
    const pluginName = pluginByFile.get(f.rel) ?? "unknown";
    const stats = byPlugin[pluginName] ?? {
      files: 0,
      functions: 0,
      calls: 0,
      imports: 0,
    };
    stats.files++;
    stats.functions += f.functions.length;
    stats.calls += f.calls.length;
    stats.imports += f.imports.filter((i) => i.resolvedPath).length;
    byPlugin[pluginName] = stats;
  }

  // 5. Aggregate ParsedClass entries from each file into the
  //    cross-file ClassDef list. Method names get resolved against
  //    the global functions array so consumers (Architecture-tab
  //    Mermaid generator) can read FunctionDef-level metadata
  //    (complexity, blast-radius targets) without re-walking
  //    cg.functions. v0.70+.
  //
  //    Disambiguation pass: many React/TS codebases declare the
  //    same name (Props, State, Config, Options) in dozens of
  //    files. Mermaid's classDiagram syntax silently merges
  //    same-named entities, producing FALSE diagrams (fields
  //    from N components show up under one Props box). To prevent
  //    that, we count occurrences of each name across all files
  //    and append a filename-derived suffix to every duplicate.
  //    Single-occurrence names (WorkspaceSummary, AnalysisSnapshot)
  //    keep their original name.
  const rawClasses: { pc: ParsedClass; filePath: string }[] = [];
  const nameCounts = new Map<string, number>();
  for (const f of parsedFiles) {
    if (!f.classes) continue;
    for (const pc of f.classes) {
      rawClasses.push({ pc, filePath: f.rel });
      nameCounts.set(pc.name, (nameCounts.get(pc.name) ?? 0) + 1);
    }
  }

  // Two-pass disambiguation. Pass 1 appends `_basenameNoExt` for any
  // name appearing more than once (the v0.70 rule). Pass 2 catches the
  // residual collision: when two duplicates share BOTH original name
  // AND basename (e.g. `tests/test_views.py` and `examples/x/test_views.py`
  // both define `class Index`), pass-1 produces `Index_test_views` for
  // BOTH — same React key, ReactFlow rejects the duplicate edge,
  // diagram shows only one entity. Surfaced on Flask in v0.77 once
  // Python class extraction shipped. Pass 2 appends a stable numeric
  // suffix (`_2`, `_3`, …) to residual collisions, in source-traversal
  // order so re-runs produce identical names.
  const initialNames = rawClasses.map(({ pc, filePath }) =>
    (nameCounts.get(pc.name) ?? 0) > 1
      ? `${pc.name}_${basenameNoExt(filePath)}`
      : pc.name
  );
  const initialCounts = new Map<string, number>();
  for (const n of initialNames) {
    initialCounts.set(n, (initialCounts.get(n) ?? 0) + 1);
  }
  const usedSuffix = new Map<string, number>();
  const finalNames = initialNames.map((n) => {
    if ((initialCounts.get(n) ?? 0) <= 1) return n;
    const next = (usedSuffix.get(n) ?? 0) + 1;
    usedSuffix.set(n, next);
    // The first occurrence keeps the bare disambiguated name to
    // stay backwards-compatible with v0.70's "Props_HeadlineFinding"
    // shape; subsequent collisions get _2, _3, ...
    return next === 1 ? n : `${n}_${next}`;
  });

  const classes: ClassDef[] = [];
  rawClasses.forEach(({ pc, filePath }, i) => {
    const uniqueName = finalNames[i];
    // Match methods by (containerType=originalName) + name in the
    // same file. We use the ORIGINAL name (pc.name), not the
    // disambiguated one — FunctionDef.containerType was set during
    // parsing and doesn't know about the suffix.
    const methods: FunctionDef[] = [];
    for (const fn of functions) {
      if (fn.filePath !== filePath) continue;
      if (fn.containerType !== pc.name) continue;
      if (!pc.methodNames.includes(fn.name)) continue;
      methods.push(fn);
    }
    classes.push({
      name: uniqueName,
      filePath,
      startRow: pc.startRow,
      endRow: pc.endRow,
      fields: pc.fields,
      methods,
      parentClass: pc.parentClass,
      baseClasses: pc.baseClasses,
      implements: pc.implements,
      isInterface: pc.isInterface,
      isAbstract: pc.isAbstract,
      isEnum: pc.isEnum,
      enumValues: pc.enumValues,
    });
  });

  // Weak-Suite: lift each test file's assertion-quality metadata onto the graph
  // (language-agnostic — just carries whatever the plugin attached).
  const testFiles: TestFileGraphEntry[] = [];
  for (const f of parsedFiles) {
    if (f.testMeta) testFiles.push({ file: f.rel, ...f.testMeta });
  }

  // Security sinks: path-tagged and carried up verbatim. Test files are kept —
  // filtering is the consumer's call, and the reachability pass drops them
  // anyway by never finding a path from an entry point.
  const sinks: SinkGraphEntry[] = [];
  for (const f of parsedFiles) {
    for (const s of f.sinks ?? []) sinks.push({ filePath: f.rel, ...s });
  }

  return {
    functions,
    calls,
    imports,
    fileComplexity,
    filesByExt,
    byPlugin,
    classes: classes.length > 0 ? classes : undefined,
    testFiles: testFiles.length > 0 ? testFiles : undefined,
    sinks: sinks.length > 0 ? sinks : undefined,
    truncated,
  };
}

/** Strip directory + extension from a posix-style file path so we
 *  get a stable suffix for class-name disambiguation. Handles the
 *  common cases (`components/HeadlineFinding.tsx` →
 *  "HeadlineFinding") plus dot-prefixed files (.eslintrc.json) and
 *  multi-dot names (foo.test.ts → "foo.test"). */
function basenameNoExt(filePath: string): string {
  const slashIdx = filePath.lastIndexOf("/");
  const base = slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath;
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0) return base; // no extension OR dot-prefixed file
  return base.slice(0, dotIdx);
}

/** Pick the best target for a call given the candidate function definitions
 *  with that name. Strategy (highest-precedence first):
 *    1. Type-aware: when the plugin supplied calleeType, prefer the
 *       candidate whose containerType matches. This is the deterministic
 *       answer for typed languages — `validatePassword.validate()` resolves
 *       to ValidatePassword.validate even when 6 other classes also have
 *       a `validate()` method. **If calleeType is set but no candidate
 *       matches, return null without falling through to proximity
 *       heuristics.** A typed receiver that isn't in our index is almost
 *       always external (System.IO.TextWriter, etc.) — silently picking a
 *       random internal method by name leads to bogus edges (observed in
 *       v0.21 serilog validation).
 *    2. Receiver-but-no-type: when the call had a receiver but the type
 *       couldn't be inferred (dynamic languages, chained calls, untyped
 *       params), DON'T single-candidate-match — that's a near-pure-luck
 *       resolution and produced 76 spurious lib->spec edges in rspec-core
 *       (v0.23). Try same-file / imported-file proximity heuristics
 *       directly; otherwise leave unresolved.
 *    3. Bare-call (no receiver, no type): single-candidate-match is
 *       reasonable. Bare calls go to top-level / module-scope functions
 *       which usually have unique names.
 *    4. Same-file fallback for ambiguous bare-or-unknown calls.
 *    5. Imported-file fallback.
 *    6. Otherwise leave unresolved. */
function pickCallTarget(
  fromFile: string,
  calleeType: string | undefined,
  hasReceiver: boolean,
  candidates: FunctionDef[],
  importsByFile: Map<string, Set<string>>,
  calleeName?: string,
  /** file -> (name it exposes -> file that defines it). See its construction. */
  symbolOrigin?: Map<string, Map<string, string>>
): FunctionDef | null {
  if (candidates.length === 0) return null;

  // 0. Production code never calls into a test.
  //
  // A test-local helper with a common name becomes a magnet for every builtin
  // call of that name in the whole codebase: `duplicates.test.ts` defines a
  // nested `find()`, so every `Array.prototype.find` in production resolved to
  // it; `workspaces.test.ts` defines `writeFile`, so `lib/atomicWrite.ts`
  // calling Node's `fs.writeFile` was shown as depending on a test. Found
  // mechanically by scripts/graph-precision.mjs — 34 such edges on zod, 8 here,
  // 4 on rspec-core. Every one of them is wrong, and one of them is exactly the
  // kind of thing that makes a user stop trusting the whole diagram.
  //
  // Direction matters and is asymmetric ON PURPOSE. Only prod→test is dropped:
  // test→prod is how computeTestCoverage derives coverage at all, and test→test
  // is ordinary helper reuse. Filtering candidates (rather than rejecting after
  // a pick) applies the rule uniformly to every strategy below, and dropping to
  // zero candidates correctly leaves the call unresolved.
  if (!isTestFile(fromFile)) {
    const prodOnly = candidates.filter((c) => !isTestFile(c.filePath));
    if (prodOnly.length === 0) return null;
    candidates = prodOnly;
  }

  // 1. Strict type-aware match.
  if (calleeType) {
    const typed = candidates.find((c) => c.containerType === calleeType);
    if (typed) return typed;
    // Fall through ONLY to top-level (no containerType) candidates,
    // and only when there's no explicit receiver. Rationale:
    //   - A method on an UNRELATED class is a false positive (the
    //     rspec/JpaRepository case — strict matching is intentional).
    //   - A top-level function with no container is a legitimate target
    //     for a bare-name call inside a method (Go's `Add(...)` calling
    //     a package-level helper from a `(c *Calculator) Process` method).
    //     The Go plugin sets calleeType=<receiver> for any bare identifier
    //     inside a method as a hint, but Go allows bare calls to package
    //     functions too — this fallthrough captures that case without
    //     loosening the strict-receiver rule for method-vs-method matches.
    if (!hasReceiver) {
      const topLevel = candidates.filter((c) => c.containerType === undefined);
      if (topLevel.length === 1) return topLevel[0];
    }
    // 1b. The "receiver" may be a MODULE, not an object.
    //
    //   from app import crud
    //   crud.get_user_by_email(session=..., email=...)
    //
    // The plugin reports calleeType="crud" because that is what precedes the
    // dot, but crud is app/crud.py — no class carries that containerType, so
    // the strict match above can never hit and hasReceiver blocks the
    // top-level fallthrough. Every module-qualified call, which is the whole
    // point of `from app import crud`, was dropped. Measured on
    // full-stack-fastapi-template: 14 of 264 own-code calls, and they are
    // route→crud / route→security edges, so each one carries a subtree.
    //
    // Three conditions together, because a bare filename match is not enough
    // evidence on its own:
    //   - the candidate is top-level (a module call cannot reach a method)
    //   - its file is named after the receiver
    //   - the caller imports that file, or a file sitting beside it — which is
    //     what `from app import crud` produces, since the spec resolves to
    //     app/__init__.py rather than to crud.py itself
    // Exactly one survivor, or we decline.
    const importedFiles = importsByFile.get(fromFile);

    // 1b-i. The receiver is a PACKAGE that re-exports the name.
    //
    //   import flask            ->  src/flask/__init__.py
    //   flask.Blueprint(...)    ->  defined in src/flask/blueprints.py
    //
    // Symbol-precise on purpose: only a name the package actually re-exports
    // resolves, so this adds no edges for unrelated modules in the package.
    // Widening `importsByFile` transitively instead would make every consumer
    // of a package depend on every module inside it, which is false and would
    // wreck the safety tiers.
    if (importedFiles && calleeName && symbolOrigin) {
      for (const imported of importedFiles) {
        if (importableNameOf(imported) !== calleeType) continue;
        const origin = symbolOrigin.get(imported)?.get(calleeName);
        if (!origin) continue;
        const inOrigin = candidates.filter((c) => c.filePath === origin);
        if (inOrigin.length === 1) return inOrigin[0];
        const topLevel = inOrigin.filter((c) => c.containerType === undefined);
        if (topLevel.length === 1) return topLevel[0];
      }
    }

    if (importedFiles) {
      const importedDirs = new Set<string>();
      for (const p of importedFiles) importedDirs.add(p.slice(0, p.lastIndexOf("/") + 1));
      const asModule = candidates.filter(
        (c) =>
          c.containerType === undefined &&
          moduleOf(c.filePath) === calleeType &&
          (importedFiles.has(c.filePath) ||
            importedDirs.has(c.filePath.slice(0, c.filePath.lastIndexOf("/") + 1)))
      );
      if (asModule.length === 1) return asModule[0];
    }
    return null;
  }

  // Common proximity helpers (used by both 2 and 3+ branches below).
  function pickByProximity(): FunctionDef | null {
    const sameFile = candidates.find((c) => c.filePath === fromFile);
    if (sameFile) return sameFile;
    const importedFiles = importsByFile.get(fromFile);
    if (importedFiles) {
      const imported = candidates.find((c) =>
        importedFiles.has(c.filePath)
      );
      if (imported) return imported;
      // `from pkg import url_for` binds the name here, but the file that
      // DEFINES url_for is the one pkg re-exports it from — never the file
      // this caller imported. Without this, a bare call to a name that exists
      // in more than one place stays unresolved even though the import says
      // exactly which one was meant. Symbol-precise: only the name the package
      // actually re-exports is followed.
      if (calleeName && symbolOrigin) {
        for (const p of importedFiles) {
          const origin = symbolOrigin.get(p)?.get(calleeName);
          if (!origin) continue;
          const hit = candidates.find((c) => c.filePath === origin);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  // 2. Receiver was present but type unknown — refuse single-candidate
  //    match. The call goes through SOMETHING; resolving by name alone is
  //    near-random when there's only one match and that match might be
  //    in unrelated code (e.g., test fixtures).
  if (hasReceiver) {
    return pickByProximity();
  }

  // 3-5. Bare call — single-candidate is the best signal we have.
  if (candidates.length === 1) return candidates[0];
  return pickByProximity();
}
