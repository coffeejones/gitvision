// Blast-radius computation. Two granularities sharing the same BFS engine:
//
//   computeBlastRadius(cg, targetFile)              — file-level
//   computeFunctionBlastRadius(cg, file, fnName)    — function-level
//
// Direction semantics (same for both granularities):
//   - incoming: who depends on / calls into the target. These break first
//     when the target's API changes.
//   - outgoing: what the target depends on / calls into. Changing any of
//     these can break the target.
//
// File-level mixes import edges + call edges (any resolved call between two
// files implies a file-level dependency).
//
// Function-level uses CallEdge only, requires both endpoints to be functions
// (fromFunction != null && toFunction != null && toFile != null), and so is
// only useful for plugins that emit resolved call edges — JS/TS, Java, Go,
// Python via Phase 5. Module-scope calls are skipped because they have no
// source-side function id.
//
// Pure functions over CodeGraph — fast enough to recompute in the client on
// every selection change.

import type { CodeGraph } from "./types";
import { cmpStr } from "../deterministicSort";

export interface BlastRadiusEntry {
  filePath: string;
  /** 1 = direct, 2 = transitive via 1 intermediate, etc. Always >= 1. */
  hop: number;
  /** True when this entry lives in a different directory than the target.
   *  Same-directory is our cross-language module heuristic — enforced by
   *  Go (1 package per dir) and idiomatic for Java/C#/Ruby/PHP/Python/
   *  JS/TS. Cross-module callers are higher-blast-radius signals: a
   *  change rippling beyond its own module is more surprising than one
   *  staying inside the package the dev was already editing. */
  crossModule: boolean;
}

export interface BlastRadius {
  target: string;
  incoming: BlastRadiusEntry[];
  outgoing: BlastRadiusEntry[];
  /** Counts grouped by hop, useful for headline numbers in UI. */
  byHop: {
    incoming: Record<number, number>;
    outgoing: Record<number, number>;
  };
  /** Subset of incoming/outgoing counts that are in a different module
   *  than the target. Use to highlight "N callers from outside this
   *  package" — a sharper risk signal than raw caller count. */
  crossModuleCounts: { incoming: number; outgoing: number };
  /** Set when the BFS hit the per-direction node cap, indicating the listed
   *  set is incomplete. */
  truncated?: string;
}

export interface FunctionBlastEntry {
  /** File the function lives in. May equal the target's filePath when the
   *  caller/callee is in the same file. */
  filePath: string;
  /** Name of the function as captured by the plugin's parser. */
  name: string;
  /** Container (class/struct/etc.) when known. v0.28+ — distinguishes
   *  same-named overloads in the same file. Undefined for top-level /
   *  module-scope functions or for legacy data without container info. */
  containerType?: string;
  hop: number;
  /** True when this function's filePath is in a different directory than
   *  the target function's filePath. See BlastRadiusEntry.crossModule. */
  crossModule: boolean;
}

export interface FunctionBlastRadius {
  target: { filePath: string; name: string; containerType?: string };
  incoming: FunctionBlastEntry[];
  outgoing: FunctionBlastEntry[];
  byHop: {
    incoming: Record<number, number>;
    outgoing: Record<number, number>;
  };
  crossModuleCounts: { incoming: number; outgoing: number };
  truncated?: string;
}

/** Return the directory portion of a repo-relative path — our same-directory
 *  module heuristic. We use forward slashes throughout the pipeline so a
 *  simple lastIndexOf split is safe. Top-level files (no slash) get an
 *  empty-string "module" so they only collide with other top-level files.
 *
 *  Why same-dir works across 8 languages:
 *    - Go: enforced (one package per directory)
 *    - Java/C#/Ruby/PHP: convention strongly followed
 *    - Python: enforced by package structure (__init__.py at each level)
 *    - JS/TS: directory boundaries match package/module organization
 *
 *  Imperfect on edge cases (Java sub-package vs parent-package both inside
 *  same `petclinic/owner/` would read as same module even though semantically
 *  one nests inside the other), but the failure mode is "missed a flag" not
 *  "false positive" — acceptable. */
export function modulePathOf(filePath: string): string {
  const lastSep = filePath.lastIndexOf("/");
  return lastSep < 0 ? "" : filePath.substring(0, lastSep);
}

export interface BlastRadiusOptions {
  /** BFS depth cap. Default 3 — beyond that the radius usually loses
   *  practical meaning ("nearly the whole codebase rolls forward"). */
  maxHops?: number;
  /** Per-direction visited-node cap. Protects the UI from rendering 5,000
   *  entries on a hub file/function. */
  maxNodes?: number;
}

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_NODES = 200;

export function computeBlastRadius(
  codeGraph: CodeGraph,
  targetFile: string,
  opts: BlastRadiusOptions = {}
): BlastRadius {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

  // Build adjacency from CodeGraph edges. Both imports and call edges
  // contribute — imports are file-level dependencies (any kind), calls are
  // function-level resolved targets (only the JS/TS plugin produces these
  // today, but the algorithm is uniform).
  const incomingAdj = new Map<string, Set<string>>(); // file → who points at me
  const outgoingAdj = new Map<string, Set<string>>(); // file → who I point at

  for (const e of codeGraph.imports) addEdge(outgoingAdj, incomingAdj, e.from, e.to);
  for (const c of codeGraph.calls) {
    if (c.toFile) addEdge(outgoingAdj, incomingAdj, c.fromFile, c.toFile);
  }

  const inc = bfs(targetFile, incomingAdj, maxHops, maxNodes);
  const out = bfs(targetFile, outgoingAdj, maxHops, maxNodes);

  const targetModule = modulePathOf(targetFile);
  const incoming = inc.entries.map((e) => ({
    ...e,
    crossModule: modulePathOf(e.filePath) !== targetModule,
  }));
  const outgoing = out.entries.map((e) => ({
    ...e,
    crossModule: modulePathOf(e.filePath) !== targetModule,
  }));

  return {
    target: targetFile,
    incoming,
    outgoing,
    byHop: {
      incoming: tallyByHop(inc.entries),
      outgoing: tallyByHop(out.entries),
    },
    crossModuleCounts: {
      incoming: incoming.filter((e) => e.crossModule).length,
      outgoing: outgoing.filter((e) => e.crossModule).length,
    },
    truncated: truncationMessage(inc.truncated || out.truncated, maxNodes, "files"),
  };
}

/** Function-level blast radius. Uses cg.calls only; an edge contributes when
 *  both endpoints are functions inside files we know about. Module-scope
 *  calls (fromFunction === null) are excluded because we'd have nothing
 *  meaningful to display on the source side.
 *
 *  v0.28: now disambiguates same-named overloads via the new
 *  CallEdge.toContainerType field. Pass `targetContainerType` when you
 *  want a specific class's method (e.g. `Blueprint.__init__`); leave it
 *  undefined to match any function with the given name in the file
 *  (legacy behavior, useful for snapshots without container data).
 *
 *  fromFunction's container is NOT tracked in CallEdge — we infer
 *  source-side from cg.functions when needed for display. For BFS
 *  matching we rely on toContainerType only. */
export function computeFunctionBlastRadius(
  codeGraph: CodeGraph,
  targetFile: string,
  targetFunction: string,
  opts: BlastRadiusOptions & { targetContainerType?: string } = {}
): FunctionBlastRadius {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const targetContainerType = opts.targetContainerType;

  // Build a (file, name) -> container lookup for the source side. CallEdge
  // doesn't carry fromContainerType; we look it up from cg.functions to
  // populate FunctionBlastEntry.containerType for callers in the result.
  const fromContainerLookup = new Map<string, string | undefined>();
  for (const fn of codeGraph.functions) {
    fromContainerLookup.set(`${fn.filePath}::${fn.name}`, fn.containerType);
  }

  const incomingAdj = new Map<string, Set<string>>();
  const outgoingAdj = new Map<string, Set<string>>();

  for (const c of codeGraph.calls) {
    if (c.fromFunction === null) continue; // module-scope; no source-side fn id
    if (c.toFile === null || c.toFunction === null) continue; // unresolved
    const fromContainer =
      fromContainerLookup.get(`${c.fromFile}::${c.fromFunction}`) ?? undefined;
    const fromId = encodeFn(c.fromFile, c.fromFunction, fromContainer);
    const toId = encodeFn(c.toFile, c.toFunction, c.toContainerType);
    addEdge(outgoingAdj, incomingAdj, fromId, toId);
  }

  const targetId = encodeFn(targetFile, targetFunction, targetContainerType);
  const inc = bfs(targetId, incomingAdj, maxHops, maxNodes);
  const out = bfs(targetId, outgoingAdj, maxHops, maxNodes);

  const targetModule = modulePathOf(targetFile);
  const decorate = (e: BfsEntry): FunctionBlastEntry => {
    const decoded = decodeFn(e.filePath);
    return {
      ...decoded,
      hop: e.hop,
      crossModule: modulePathOf(decoded.filePath) !== targetModule,
    };
  };
  const incoming = inc.entries.map(decorate);
  const outgoing = out.entries.map(decorate);

  return {
    target: {
      filePath: targetFile,
      name: targetFunction,
      containerType: targetContainerType,
    },
    incoming,
    outgoing,
    byHop: {
      incoming: tallyByHop(inc.entries),
      outgoing: tallyByHop(out.entries),
    },
    crossModuleCounts: {
      incoming: incoming.filter((e) => e.crossModule).length,
      outgoing: outgoing.filter((e) => e.crossModule).length,
    },
    truncated: truncationMessage(
      inc.truncated || out.truncated,
      maxNodes,
      "functions"
    ),
  };
}

// ---------------- internals ----------------

/** Encode a (file, fnName, containerType?) tuple as a single string id for
 *  the BFS engine. We use ASCII Record Separator (\x1E, U+001E) — a
 *  control character that can't appear in file paths, identifiers, or
 *  type names in any language we support. Empty containerType slot means
 *  "no container known"; functions in the same file with the same name
 *  but different containers (e.g. two classes' __init__) get distinct ids. */
const SEP = "";

function encodeFn(
  filePath: string,
  name: string,
  containerType: string | undefined
): string {
  return `${filePath}${SEP}${name}${SEP}${containerType ?? ""}`;
}

function decodeFn(id: string): {
  filePath: string;
  name: string;
  containerType?: string;
} {
  const parts = id.split(SEP);
  return {
    filePath: parts[0] ?? "",
    name: parts[1] ?? "",
    containerType: parts[2] ? parts[2] : undefined,
  };
}

function truncationMessage(
  truncated: boolean,
  maxNodes: number,
  unit: "files" | "functions"
): string | undefined {
  return truncated ? `Capped at ${maxNodes} ${unit} per direction` : undefined;
}

function addEdge(
  outgoingAdj: Map<string, Set<string>>,
  incomingAdj: Map<string, Set<string>>,
  from: string,
  to: string
): void {
  if (from === to) return; // self-edges aren't blast-radius signal
  let outs = outgoingAdj.get(from);
  if (!outs) {
    outs = new Set();
    outgoingAdj.set(from, outs);
  }
  outs.add(to);
  let ins = incomingAdj.get(to);
  if (!ins) {
    ins = new Set();
    incomingAdj.set(to, ins);
  }
  ins.add(from);
}

/** Internal BFS shape — bare (filePath, hop) tuples. compute* functions
 *  decorate these with crossModule before returning to callers. Keeping the
 *  BFS result minimal lets us reuse the same BFS for both file-level and
 *  function-level paths (the function-level "filePath" here is actually an
 *  encoded function id; decoding + cross-module flagging both happen in
 *  the caller). */
interface BfsEntry {
  filePath: string;
  hop: number;
}

interface BfsResult {
  entries: BfsEntry[];
  truncated: boolean;
}

function bfs(
  start: string,
  adj: Map<string, Set<string>>,
  maxHops: number,
  maxNodes: number
): BfsResult {
  const hopOf = new Map<string, number>();
  hopOf.set(start, 0);
  const queue: string[] = [start];
  // Tracks result entries only — start is excluded so the cap reflects what
  // the UI actually displays. Without this you'd see "Capped at 200" with
  // 199 entries because the visited Map includes the target.
  let entryCount = 0;
  let truncated = false;

  while (queue.length > 0) {
    const file = queue.shift()!;
    const hop = hopOf.get(file)!;
    if (hop >= maxHops) continue;
    const neighbors = adj.get(file);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (hopOf.has(n)) continue;
      if (entryCount >= maxNodes) {
        truncated = true;
        break;
      }
      hopOf.set(n, hop + 1);
      queue.push(n);
      entryCount++;
    }
    if (truncated) break;
  }

  const entries: BfsEntry[] = [];
  for (const [file, hop] of hopOf) {
    if (file === start) continue;
    entries.push({ filePath: file, hop });
  }
  entries.sort((a, b) => a.hop - b.hop || cmpStr(a.filePath, b.filePath));
  return { entries, truncated };
}

function tallyByHop(entries: BfsEntry[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of entries) out[e.hop] = (out[e.hop] ?? 0) + 1;
  return out;
}
