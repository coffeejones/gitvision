// A contents-free FileIndex for the patcher. Import resolution (for JS/TS,
// which is all the fast path re-resolves) needs only the repo's PATH set —
// `resolveJsImport`/`resolveAgainstFiles` do `byPath.has(candidate)` key checks
// and read the persisted per-plugin extras; they never touch another file's
// `.content` (verified javascript.ts:221-261). So re-parsing/re-resolving one
// file against the whole repo needs just the (patched) path list + extras, with
// no other file contents in memory.

import type { FileIndex, SourceFile } from "@/lib/codeAnalysis/types";

function extOf(rel: string): string {
  const dot = rel.lastIndexOf(".");
  return dot === -1 ? "" : rel.slice(dot + 1).toLowerCase();
}

/** Build a FileIndex over `paths` (the patched path set) carrying the persisted
 *  resolver `extras`. SourceFile.content is empty — resolvers only key on paths. */
export function buildStubIndex(
  paths: Iterable<string>,
  extras: Map<string, unknown>,
): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const rel of paths) {
    const ext = extOf(rel);
    const sf: SourceFile = { rel, ext, content: "" };
    byPath.set(rel, sf);
    const arr = byExt.get(ext);
    if (arr) arr.push(sf);
    else byExt.set(ext, [sf]);
  }
  return { byPath, byExt, extras };
}
