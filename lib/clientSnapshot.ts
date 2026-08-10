// The shape of a snapshot that is safe to hand to a client component.
//
// app/session/[id]/layout.tsx passes the latest snapshot to SessionToolbar and
// SessionShell, both of which are client components. Everything reachable from a
// client prop is serialized into the RSC flight payload, so the whole code graph
// was being shipped to the browser on EVERY tab in the workspace — including the
// ones with nothing to do with code.
//
// Measured on the zod session before this module existed:
//   /session/<id>/prs   7,092,975 bytes (415,842 gzipped)
//   graph-free floor      178,684 bytes
//   34,687 occurrences of `toFile`, 1,744 of `bodyHash` in the HTML of a page
//   about pull requests.
// codeGraph is 88.2% of that snapshot (5.59 MB of 6.34 MB). Gzip hides most of
// it on the wire, but the browser still inflates and parses all of it before it
// can paint.
//
// What actually needed the graph client-side was small:
//   - SessionShell: two booleans and three .length counts (ShellGraphCounts)
//   - CommandPalette: the top 200 files and top 200 functions (PaletteIndex)
//   - WallCardModal: a full refactor-safety pass — now fetched from
//     /api/sessions/[id]/refactor-safety when the dialog opens
//
// THE Omit IS THE POINT. `codeGraph` is optional on AnalysisSnapshot, so a
// stripped snapshot would type-check silently against the old prop types and the
// boundary would rot the first time someone reached for `snapshot.codeGraph` in a
// client component. Typing those props as ClientSnapshot turns that reach into a
// compile error instead of a 6 MB regression nobody notices.

import type { AnalysisSnapshot } from "./types";

/** A snapshot with the code graph removed. Client component props take THIS,
 *  never AnalysisSnapshot — see the note above on why Omit rather than trusting
 *  the field's optionality. */
export type ClientSnapshot = Omit<AnalysisSnapshot, "codeGraph">;

/** The scalars SessionShell derives from the graphs, so it does not need them.
 *  `fileGraph` stays on ClientSnapshot (48 KB, and the canvas reads it), but the
 *  counts are computed here so both graphs are treated the same way. */
export interface ShellGraphCounts {
  hasGraph: boolean;
  hasCodeGraph: boolean;
  depCount: number;
  codeFunctionCount: number;
  classCount: number;
}

/** One searchable file in the palette. */
export interface PaletteFile {
  path: string;
  complexity: number;
}

/** One searchable symbol in the palette. Mirrors the fields the palette puts in
 *  its label, hint and href — nothing else travels. */
export interface PaletteFunction {
  name: string;
  filePath: string;
  containerType?: string;
  complexity: number;
}

export interface PaletteIndex {
  files: PaletteFile[];
  functions: PaletteFunction[];
}

/** Caps live here rather than in the palette because the slicing now happens on
 *  the server. Same numbers the client used: enough to search a real repo,
 *  bounded so a monorepo like golang/go does not make every keystroke filter
 *  through six thousand paths. */
export const MAX_PALETTE_FILES = 200;
export const MAX_PALETTE_FUNCTIONS = 200;

/** The Code tab is the one page that genuinely needs the graph in the browser:
 *  it recomputes duplicates and blast radius as the reader picks files, so the
 *  ClientSnapshot boundary above cannot apply to it.
 *
 *  What it does NOT need is the BULK of the unresolved call edges. Blast radius
 *  skips them explicitly (`if (c.toFile === null) continue`), and the one
 *  consumer that needs them all — the own-call-resolution percentage — is
 *  already computed server-side.
 *
 *  One unresolved edge per distinct caller FILE is kept, though, and that
 *  exception is the whole point of this function having a doc comment.
 *
 *  This used to drop them outright, on the stated grounds that "test coverage
 *  only reads edges with a toFile". It does not: computeTestCoverage's step 1
 *  calls `classify(c.fromFile)` for EVERY edge, resolved or not, precisely
 *  because a test file's own function defs sometimes never land in
 *  cg.functions — its outgoing calls are the only evidence the file exists. So
 *  dropping unresolved edges deleted test files from the client-side pass while
 *  the server-side pass on the same page still counted them. Measured on stored
 *  sessions: zod 172 -> 92, flask 44 -> 37, rspec-core 103 -> 98, serilog
 *  96 -> 93. The Untested-hotspots tooltip renders that number, and
 *  CodePanel.tsx gates the entire panel on it being above zero.
 *
 *  Classification is per distinct PATH, so one edge per path restores it
 *  exactly. The cost is bounded by the file count rather than the edge count —
 *  on NetBox that is a few thousand edges against the 72,783 dropped.
 *
 *  Measured on NetBox: 81,013 call edges, of which 8,230 resolve. `calls` is
 *  17 MB of the graph's 23 MB, and dropping the unresolved ones takes it to
 *  about 2 MB — the page from 26 MB to roughly 11. */
export function toCodeTabSnapshot(snapshot: AnalysisSnapshot): AnalysisSnapshot {
  const cg = snapshot.codeGraph;
  if (!cg) return snapshot;
  const seenUnresolvedFrom = new Set<string>();
  const calls = cg.calls.filter((c) => {
    if (c.toFile !== null && c.toFile !== undefined) return true;
    if (seenUnresolvedFrom.has(c.fromFile)) return false;
    seenUnresolvedFrom.add(c.fromFile);
    return true;
  });
  return { ...snapshot, codeGraph: { ...cg, calls } };
}

export function toClientSnapshot(snapshot: AnalysisSnapshot): ClientSnapshot {
  // Destructure rather than delete: `rest` is a fresh object, so the original
  // snapshot (which server components on the same request still use, via the
  // cached read) is untouched.
  const { codeGraph: _codeGraph, ...rest } = snapshot;
  return rest;
}

export function computeShellGraphCounts(snapshot: AnalysisSnapshot): ShellGraphCounts {
  return {
    hasGraph: !!snapshot.fileGraph,
    hasCodeGraph: !!snapshot.codeGraph,
    depCount: snapshot.fileGraph?.nodes.length ?? 0,
    codeFunctionCount: snapshot.codeGraph?.functions.length ?? 0,
    classCount: snapshot.codeGraph?.classes?.length ?? 0,
  };
}

/** Build the palette's searchable index. Returns null when the snapshot has no
 *  code graph, which is the same condition the palette used to check itself
 *  (`if (!cg) return pages`) — the caller renders pages only. */
export function buildPaletteIndex(snapshot: AnalysisSnapshot): PaletteIndex | null {
  const cg = snapshot.codeGraph;
  if (!cg) return null;

  const files: PaletteFile[] = Object.entries(cg.fileComplexity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_PALETTE_FILES)
    .map(([path, complexity]) => ({ path, complexity }));

  const functions: PaletteFunction[] = [...cg.functions]
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, MAX_PALETTE_FUNCTIONS)
    .map((fn) => ({
      name: fn.name,
      filePath: fn.filePath,
      containerType: fn.containerType,
      complexity: fn.complexity,
    }));

  return { files, functions };
}
