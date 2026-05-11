// Diff-aware analysis. Given two CodeGraph snapshots (base = target branch,
// head = PR branch), compute which functions changed. Powers the PR-comment
// claims that depend on "what's different between these two states", which
// single-snapshot tools can't answer:
//
//   "Owner.addVisit complexity 6 → 11"
//   "3 functions modified across 2 files"
//   "net complexity +7 across the PR"
//   "X is new in this PR" / "Y was deleted"
//
// Strategy: snapshot-diff (Approach 1). Match functions across snapshots by
// strict identity tuple (filePath, name, containerType). Renames look like
// remove+add — pragmatic start, refine if data demands it.
//
// Body-changed-but-complexity-same case is caught via the existing bodyHash
// field (FNV-1a 64 structural AST hash, populated by all plugins for the
// duplicate-detection feature in v0.30). When both sides have a hash, mismatched
// hashes flag a modified function even when complexity is unchanged. When
// either side lacks a hash (legacy snapshot, plugin not yet instrumented),
// the diff falls back to complexity-only and bodyChanged is left undefined.
//
// What this can NOT yet do:
//   - Identify *what* changed inside a modified function (statement-level AST diff)
//   - Detect renames as renames rather than remove+add
//   - Distinguish multiple anonymous closures in the same file
// These are forward-compatible additions — the ChangedFunction shape can be
// extended with branchChanges / renameOf / etc. without breaking callers.

import type { CodeGraph, FunctionDef } from "./types";

export interface ChangedFunction {
  filePath: string;
  name: string;
  containerType?: string;
  status: "added" | "removed" | "modified" | "unchanged";
  /** Defined for "modified" | "removed" | "unchanged". */
  complexityBefore?: number;
  /** Defined for "modified" | "added" | "unchanged". */
  complexityAfter?: number;
  /** Defined for "modified" only — convenience field = after − before. */
  complexityDelta?: number;
  /** Source location in the base snapshot. Defined for "modified" |
   *  "removed" | "unchanged". Use this to link to the base-branch source
   *  in a PR-comment context. */
  startRowBefore?: number;
  /** Source location in the head snapshot. Defined for "modified" |
   *  "added" | "unchanged". Use this to link to the head-branch source. */
  startRowAfter?: number;
  /** True when bodyHash differs between base and head — the function's
   *  structural shape changed even if complexity didn't. False when both
   *  hashes match (i.e. unchanged status, or modified-by-complexity-only).
   *  Undefined when either side lacks a bodyHash (legacy snapshot or
   *  plugin without hash support) — caller should treat as "unknown" and
   *  rely on complexity delta instead. */
  bodyChanged?: boolean;
}

export interface DiffSummary {
  /** Number of distinct files containing at least one added/removed/modified
   *  function. Unchanged functions do not count. */
  filesChanged: number;
  functionsAdded: number;
  functionsRemoved: number;
  functionsModified: number;
  /** Sum of complexityDelta across all modified functions. Can be negative
   *  if the PR is net-simplifying (refactor with smaller branches). */
  netComplexityDelta: number;
}

export interface DiffResult {
  summary: DiffSummary;
  /** Sorted by filePath, then by post-diff source row. Default contains
   *  only added/removed/modified; pass `includeUnchanged: true` to also
   *  include unchanged functions (e.g. for full-context UI displays). */
  changes: ChangedFunction[];
}

export interface DiffOptions {
  /** When true, the result includes unchanged functions too. Use for full
   *  diff context ("PR touched 3 of 47 functions"). Default false to keep
   *  output focused on what changed. */
  includeUnchanged?: boolean;
}

export function computeDiff(
  base: CodeGraph,
  head: CodeGraph,
  opts: DiffOptions = {}
): DiffResult {
  // Step 1: index both snapshots by identity key.
  const baseMap = new Map<string, FunctionDef>();
  for (const fn of base.functions) {
    baseMap.set(identityKey(fn), fn);
  }
  const headMap = new Map<string, FunctionDef>();
  for (const fn of head.functions) {
    headMap.set(identityKey(fn), fn);
  }

  const changes: ChangedFunction[] = [];
  const seenKeys = new Set<string>();

  // Step 2: walk base — classify each as removed | modified | unchanged.
  for (const [key, fn] of baseMap) {
    seenKeys.add(key);
    const headFn = headMap.get(key);
    if (!headFn) {
      changes.push({
        filePath: fn.filePath,
        name: fn.name,
        containerType: fn.containerType,
        status: "removed",
        complexityBefore: fn.complexity,
        startRowBefore: fn.startRow,
      });
      continue;
    }
    // Both sides have this function. Decide modified vs unchanged.
    const complexityChanged = fn.complexity !== headFn.complexity;
    const bodyChanged = computeBodyChanged(fn.bodyHash, headFn.bodyHash);
    const isModified = complexityChanged || bodyChanged === true;
    if (isModified) {
      changes.push({
        filePath: fn.filePath,
        name: fn.name,
        containerType: fn.containerType,
        status: "modified",
        complexityBefore: fn.complexity,
        complexityAfter: headFn.complexity,
        complexityDelta: headFn.complexity - fn.complexity,
        startRowBefore: fn.startRow,
        startRowAfter: headFn.startRow,
        bodyChanged,
      });
    } else if (opts.includeUnchanged) {
      changes.push({
        filePath: fn.filePath,
        name: fn.name,
        containerType: fn.containerType,
        status: "unchanged",
        complexityBefore: fn.complexity,
        complexityAfter: headFn.complexity,
        startRowBefore: fn.startRow,
        startRowAfter: headFn.startRow,
        bodyChanged,
      });
    }
  }

  // Step 3: walk head — anything we haven't seen is added.
  for (const [key, fn] of headMap) {
    if (seenKeys.has(key)) continue;
    changes.push({
      filePath: fn.filePath,
      name: fn.name,
      containerType: fn.containerType,
      status: "added",
      complexityAfter: fn.complexity,
      startRowAfter: fn.startRow,
    });
  }

  // Step 4: sort by filePath then by source row (prefer post-diff row).
  changes.sort((a, b) => {
    const fileCmp = a.filePath.localeCompare(b.filePath);
    if (fileCmp !== 0) return fileCmp;
    const aRow = a.startRowAfter ?? a.startRowBefore ?? 0;
    const bRow = b.startRowAfter ?? b.startRowBefore ?? 0;
    return aRow - bRow;
  });

  // Step 5: aggregate summary. Unchanged functions do NOT count toward
  // filesChanged or any of the function-count fields.
  const filesChanged = new Set<string>();
  let added = 0;
  let removed = 0;
  let modified = 0;
  let netDelta = 0;
  for (const c of changes) {
    if (c.status === "unchanged") continue;
    filesChanged.add(c.filePath);
    if (c.status === "added") added++;
    else if (c.status === "removed") removed++;
    else if (c.status === "modified") {
      modified++;
      netDelta += c.complexityDelta ?? 0;
    }
  }

  return {
    summary: {
      filesChanged: filesChanged.size,
      functionsAdded: added,
      functionsRemoved: removed,
      functionsModified: modified,
      netComplexityDelta: netDelta,
    },
    changes,
  };
}

// ---------------- internals ----------------

/** Identity key for matching a function across two snapshots. Strict
 *  (filePath, name, containerType) tuple. Uses ASCII Record Separator
 *  (\x1E) — same convention as blastRadius.encodeFn — to avoid collisions
 *  with any legal path or identifier character. */
const SEP = "\x1E";

function identityKey(fn: FunctionDef): string {
  return `${fn.filePath}${SEP}${fn.name}${SEP}${fn.containerType ?? ""}`;
}

/** Returns true | false when both sides have a hash and we can compare;
 *  returns undefined when either side lacks one (legacy snapshot). Callers
 *  treat undefined as "fall back to complexity check, body status is
 *  unknown". */
function computeBodyChanged(
  before: string | undefined,
  after: string | undefined
): boolean | undefined {
  if (before === undefined || after === undefined) return undefined;
  return before !== after;
}
