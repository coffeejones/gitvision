// Directory-level analysis. Walks a local path, loads all plugin grammars,
// parses every file matching a plugin's extensions, and returns aggregated
// results. Used by the dev CLI today; the production orchestrator (Phase 3)
// will use the same primitives on top of a tarball-extracted directory.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodeAnalysisPlugin,
  CodeGraph,
  FileIndex,
  ParsedFile,
  SourceFile,
} from "./types";
import { parseFile } from "./parse";
import { buildCodeGraph } from "./codeGraph";
import {
  DEFAULT_MAX_FILES,
  MAX_FILE_BYTES,
  djb2,
  looksMinifiedByContent,
  looksVendoredByPath,
  shouldSkipDir,
} from "./fileUniverse";

// Re-exported so existing importers (and tests) keep resolving these from
// `analyze`; the definitions now live in fileUniverse (shared with the patcher).
export { looksVendoredByPath, looksMinifiedByContent };

export interface AnalysisTotals {
  filesScanned: number;
  filesParsed: number;
  parseErrors: number;
  functions: number;
  imports: number;
  resolvedImports: number;
  calls: number;
  /** Calls whose `calleeName` matches a known function name in the project. */
  resolvedCalls: number;
}

export interface AnalysisResult {
  root: string;
  files: ParsedFile[];
  /** The cross-file aggregate. Phase 4 will lift this onto AnalysisSnapshot.codeGraph. */
  codeGraph: CodeGraph;
  totals: AnalysisTotals;
  elapsedMs: number;
  truncated: boolean;
  /** Which plugin parsed each file — the byPlugin/graph-rebuild input. Exposed
   *  (with `files` + `extras`) so a caller can persist the parse layer for the
   *  Shadow-Graph patcher; production used to discard all three. */
  pluginByFile: Map<string, string>;
  /** Per-plugin resolver contexts (FileIndex.extras) needed to re-parse a
   *  changed file's imports without the repo on disk. */
  extras: Map<string, unknown>;
}

export interface AnalyzeOptions {
  maxFiles?: number;
}

/** Walk + parse a local directory. Loads all plugins' grammars up-front. */
export async function analyzeDirectory(
  root: string,
  plugins: CodeAnalysisPlugin[],
  opts: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const start = Date.now();
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  await Promise.all(plugins.map((p) => p.load()));

  const pluginByExt = new Map<string, CodeAnalysisPlugin>();
  for (const p of plugins) {
    for (const ext of p.extensions) pluginByExt.set(ext, p);
  }

  const { files: walkedFiles, truncated } = await walkAndRead(
    root,
    pluginByExt,
    maxFiles
  );

  // Canonical order: sort every downstream pass (parse, graph build, content
  // hashes, per-plugin `prepareForRepo` extras) by repo-relative path. The
  // walker's order is `fs.readdir` order, which is OS-dependent — so without
  // this, two machines (Mac / Windows / Railway Linux) can produce different
  // call-edge tie-breaks and class-name disambiguation suffixes for the *same*
  // repo. Code-unit comparison (not `localeCompare`) keeps ordering identical
  // across ICU/locale configurations. This determinism is also the invariant
  // the Shadow-Graph incremental patcher relies on: a re-parsed/added file must
  // land at a stable position so a patched graph is byte-identical to a full
  // re-analysis.
  const sourceFiles = [...walkedFiles].sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  );

  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of sourceFiles) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  const fileIndex: FileIndex = { byPath, byExt, extras: new Map() };

  // Per-repo plugin setup (e.g. tsconfig paths). Plugins that don't need
  // anything skip this hook; the orchestrator stays language-agnostic.
  for (const p of plugins) {
    if (p.prepareForRepo) {
      try {
        await p.prepareForRepo(root, fileIndex);
      } catch (err) {
        console.error(
          `prepareForRepo failed for ${p.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  const parsed: ParsedFile[] = [];
  /** Records which plugin parsed each file. Drives CodeGraph.byPlugin stats
   *  and lets the debug API/CLI show coverage per language family. */
  const pluginByFile = new Map<string, string>();
  let parsedSinceYield = 0;
  for (const f of sourceFiles) {
    const plugin = pluginByExt.get(f.ext);
    if (!plugin) continue;
    // Yield the single Node event loop periodically. tree-sitter parsing is
    // synchronous, so a big analysis (thousands of files) would otherwise
    // monopolize the process for seconds — starving every other request,
    // including an interactive Shadow-Graph simulate, job polling, and SSR.
    // Batches of 64 keep the overhead negligible while breaking the block up.
    if (++parsedSinceYield >= 64) {
      parsedSinceYield = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    try {
      parsed.push(parseFile(plugin, f, fileIndex));
      pluginByFile.set(f.rel, plugin.name);
    } catch (err) {
      parsed.push({
        rel: f.rel,
        imports: [],
        functions: [],
        calls: [],
        fileComplexity: 1,
        parseError: true,
      });
      pluginByFile.set(f.rel, plugin.name);
      // Don't let one bad file kill the run — but surface it
      console.error(
        `parse failed for ${f.rel}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Build the CodeGraph (cross-file aggregate). The orchestrator passes the
  // plugin-by-file map so byPlugin stats stay accurate without ParsedFile
  // having to carry plugin identity itself.
  const codeGraph = buildCodeGraph({
    parsedFiles: parsed,
    pluginByFile,
    truncated: truncated
      ? `Walker hit MAX_FILES cap (${maxFiles})`
      : undefined,
  });

  // Raw-content fingerprint per file (djb2). The function/complexity signature
  // is blind to regex-fallback languages (they emit no functions + constant
  // complexity), so a .kt/.html/.css edit would look unchanged to the
  // change-blast diff. Hashing the raw source closes that gap.
  const contentHashes: Record<string, string> = {};
  for (const f of sourceFiles) contentHashes[f.rel] = djb2(f.content);
  codeGraph.contentHashes = contentHashes;

  const totals: AnalysisTotals = {
    filesScanned: sourceFiles.length,
    filesParsed: parsed.filter((p) => !p.parseError).length,
    parseErrors: parsed.filter((p) => p.parseError).length,
    functions: codeGraph.functions.length,
    imports: parsed.reduce((s, p) => s + p.imports.length, 0),
    resolvedImports: codeGraph.imports.length,
    calls: codeGraph.calls.length,
    resolvedCalls: codeGraph.calls.filter((c) => c.toFile !== null).length,
  };

  return {
    root,
    files: parsed,
    codeGraph,
    totals,
    elapsedMs: Date.now() - start,
    truncated,
    pluginByFile,
    extras: fileIndex.extras,
  };
}

async function walkAndRead(
  root: string,
  pluginByExt: Map<string, CodeAnalysisPlugin>,
  maxFiles: number
): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const out: SourceFile[] = [];
  let truncated = false;

  async function visit(dir: string): Promise<void> {
    if (out.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
        await visit(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (!pluginByExt.has(ext)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        // Path-based pre-filter: cheap, skips before we even open the file
        if (looksVendoredByPath(rel)) continue;
        try {
          const st = await fs.stat(full);
          if (st.size > MAX_FILE_BYTES) continue;
          const content = await fs.readFile(full, "utf-8");
          // Content-based filter: catches minified bundles that don't have
          // a giveaway path. Real source code virtually never has the
          // average-line-length signatures we look for.
          if (looksMinifiedByContent(content)) continue;
          out.push({ rel, ext, content });
        } catch {
          continue;
        }
      }
    }
  }

  await visit(root);
  return { files: out, truncated };
}

