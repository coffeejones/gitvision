// The Shadow-Graph patch engine (Stage 1). Given a cached parse layer (a repo's
// ParsedFile[] + resolver extras at some base state) and a set of file changes,
// produce the CodeGraph the repo WOULD have if those changes were applied —
// without re-cloning or re-parsing the whole thing.
//
// Strategy: cached-parse + FULL REBUILD. Re-parse only the touched files, splice
// them into a copy of the cached file array, then run the PRODUCTION
// buildCodeGraph over the result. Because it reuses the exact analysis code path,
// the output is byte-identical to a from-scratch analysis (the golden-equivalence
// contract) — for the JS/TS-precise fast path. Non-JS / build-config / truncated
// changes return a declared mode/approximation instead of a silent divergence.
//
// This module is PURE (no I/O, no worker) so it can be unit-tested against a
// from-scratch analysis. The cache read and the worker/timeout wrapper live
// elsewhere.

import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import { parseFile } from "../codeAnalysis/parse";
import { djb2, isAnalyzableFile } from "../codeAnalysis/fileUniverse";
import type {
  CodeAnalysisPlugin,
  CodeGraph,
  ParsedFile,
} from "../codeAnalysis/types";
import type { ParseLayer } from "./parseCache";
import { buildStubIndex } from "./stubIndex";

/** A single change in a simulated diff. `newContent: null` deletes; a string
 *  adds-or-modifies. `baseHash` (djb2 of the file's BASE content) lets the engine
 *  detect it's judging against the wrong base. */
export interface FileChange {
  path: string;
  newContent: string | null;
  baseHash?: string;
}

export type PatchMode =
  | "patched"
  | "needs-full-analysis"
  | "too-large"
  | "base-mismatch";

export interface PatchResult {
  mode: PatchMode;
  /** Present only when mode === "patched". */
  graph?: CodeGraph;
  /** Honest, machine-readable caveats (e.g. non-JS import edges frozen at base). */
  approximations: string[];
  /** Files whose supplied baseHash didn't match the cache (mode base-mismatch). */
  baseMismatch?: string[];
  /** Why a non-patched mode was returned. */
  reason?: string;
}

/** Cumulative touched-bytes budget for the fast path. A coarse gate — the real
 *  DoS control is the worker wall-clock timeout (adversarial dense content parses
 *  slowly regardless of size). Normal agent diffs are far under this. */
const MAX_PATCH_BYTES = 2 * 1024 * 1024;

const utf8 = (s: string) => Buffer.byteLength(s, "utf-8");

function extOf(rel: string): string {
  const dot = rel.lastIndexOf(".");
  return dot === -1 ? "" : rel.slice(dot + 1).toLowerCase();
}

function errorParsedFile(rel: string): ParsedFile {
  return {
    rel,
    imports: [],
    functions: [],
    calls: [],
    fileComplexity: 1,
    parseError: true,
  };
}

/** Build-config files whose edits change resolution repo-wide in ways the cache
 *  can't rebuild from one file's content (workspace maps need every package.json
 *  + fs probing). Not fast-patched in v1 — routed to full re-analysis. */
function isConfigFile(p: string): boolean {
  const base = (p.split("/").pop() ?? p).toLowerCase();
  return (
    /^tsconfig(\..+)?\.json$/.test(base) ||
    base === "jsconfig.json" ||
    base === "package.json" ||
    base === "go.mod" ||
    base === "composer.json" ||
    base === "gemfile" ||
    /\.csproj$/.test(base)
  );
}

const byRelAsc = (a: { rel: string }, b: { rel: string }) =>
  a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;

/** Apply `changes` to `layer` and return the patched CodeGraph (or a declared
 *  non-patched mode). `plugins` must be loaded (grammars ready). */
export function patch(
  layer: ParseLayer,
  changes: FileChange[],
  plugins: CodeAnalysisPlugin[],
): PatchResult {
  const approximations: string[] = [];

  const pluginByExt = new Map<string, CodeAnalysisPlugin>();
  for (const p of plugins) for (const ext of p.extensions) pluginByExt.set(ext, p);
  const jsPlugin = plugins.find((p) => p.fastPatchable);
  const hasPlugin = (ext: string) => pluginByExt.has(ext);

  // 1. Base integrity — the caller is editing a state we didn't analyze.
  const baseMismatch: string[] = [];
  for (const c of changes) {
    if (c.baseHash == null) continue;
    const cached = layer.contentHashes[c.path];
    if (cached !== undefined && cached !== c.baseHash) baseMismatch.push(c.path);
  }
  if (baseMismatch.length > 0) {
    return { mode: "base-mismatch", baseMismatch, approximations };
  }

  // 2. Build-config edit → can't fast-patch (§6.3).
  const configFile = changes.find((c) => isConfigFile(c.path));
  if (configFile) {
    return {
      mode: "needs-full-analysis",
      reason: `build-config change (${configFile.path})`,
      approximations,
    };
  }

  // 3. Parse-cost pre-gate (§6.6).
  const touchedBytes = changes.reduce(
    (n, c) => n + (c.newContent != null ? utf8(c.newContent) : 0),
    0,
  );
  if (touchedBytes > MAX_PATCH_BYTES) {
    return { mode: "too-large", reason: "cumulative touched bytes over budget", approximations };
  }

  // 4. Patch the file set (on COPIES — never mutate the cached layer).
  const patchedByRel = new Map(layer.files.map((f) => [f.rel, f]));
  const pluginByFile = new Map(layer.pluginByFile);
  const contentHashes: Record<string, string> = { ...layer.contentHashes };
  const touchedLangs = new Set<string>();
  const touchedRels = new Set<string>();
  const toParse: { rel: string; ext: string; content: string; plugin: CodeAnalysisPlugin }[] = [];
  let pathSetChanged = false;

  const drop = (rel: string) => {
    if (patchedByRel.delete(rel)) {
      pluginByFile.delete(rel);
      delete contentHashes[rel];
      pathSetChanged = true;
    }
  };

  for (const c of changes) {
    const ext = extOf(c.path);
    const plugin = pluginByExt.get(ext);

    if (c.newContent === null) {
      drop(c.path); // delete (no-op if it wasn't analyzed)
      if (plugin && !plugin.fastPatchable) touchedLangs.add(plugin.name);
      continue;
    }

    if (!plugin) continue; // no plugin claims this ext — not in the parse universe

    // Full analysis would EXCLUDE a file failing the universe gates → treat an
    // add/modify that now fails as a delete, so the patched set matches.
    const admitted = isAnalyzableFile({
      rel: c.path,
      ext,
      byteLength: utf8(c.newContent),
      content: c.newContent,
      hasPlugin,
    });
    if (!admitted) {
      drop(c.path);
      continue;
    }

    if (!patchedByRel.has(c.path)) pathSetChanged = true; // an add changes the path set
    // Reserve the slot; the actual parse happens after the final path set is
    // known (import resolution needs the complete path set).
    patchedByRel.set(c.path, errorParsedFile(c.path));
    pluginByFile.set(c.path, plugin.name);
    contentHashes[c.path] = djb2(c.newContent);
    touchedRels.add(c.path);
    if (!plugin.fastPatchable) touchedLangs.add(plugin.name);
    toParse.push({ rel: c.path, ext, content: c.newContent, plugin });
  }

  // 5. Stub index over the FINAL patched path set + persisted extras.
  const stubIndex = buildStubIndex(patchedByRel.keys(), layer.extras);

  // 6. Parse the touched files against the final index (crash-contained).
  for (const t of toParse) {
    let parsed: ParsedFile;
    try {
      parsed = parseFile(t.plugin, { rel: t.rel, ext: t.ext, content: t.content }, stubIndex);
    } catch {
      parsed = errorParsedFile(t.rel);
    }
    patchedByRel.set(t.rel, parsed);
  }

  // 7. On a path-set change, re-resolve every UNTOUCHED fast-patchable (JS/TS)
  //    file's imports from its preserved rawSpec — adds/deletes can shadow or
  //    re-route another file's `./foo`. Non-fast-patchable languages are frozen
  //    at base (declared approximation). A pure content edit needs none of this.
  if (pathSetChanged && jsPlugin) {
    for (const [rel, f] of patchedByRel) {
      if (touchedRels.has(rel)) continue;
      if (pluginByFile.get(rel) !== jsPlugin.name) continue;
      if (f.imports.length === 0) continue;
      const imports = f.imports.map((imp) => ({
        ...imp,
        resolvedPath: jsPlugin.resolveImport(imp.rawSpec, rel, stubIndex),
      }));
      patchedByRel.set(rel, { ...f, imports });
    }
  }

  // 8. Declare the non-JS approximation, if any.
  if (touchedLangs.size > 0) {
    approximations.push(
      `cross-file import edges are frozen at base (not re-resolved) for: ${[...touchedLangs].sort().join(", ")}`,
    );
  }

  // 9. Canonical sort + production rebuild + contentHashes reattach (analyzeDirectory
  //    adds those after buildCodeGraph; canonical key order for byte-equality).
  const patchedFiles = [...patchedByRel.values()].sort(byRelAsc);
  const graph = buildCodeGraph({ parsedFiles: patchedFiles, pluginByFile });
  const sortedHashes: Record<string, string> = {};
  for (const k of Object.keys(contentHashes).sort()) sortedHashes[k] = contentHashes[k];
  graph.contentHashes = sortedHashes;

  return { mode: "patched", graph, approximations };
}
