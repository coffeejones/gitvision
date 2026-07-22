// Client-safe home for the per-function signal set + its pure builder.
//
// Split out of functionExplain.ts, which imports the Anthropic SDK at module
// load. The Source view's FunctionInsight panel needs to build the deterministic
// evidence row on the client so it can show INSTANTLY — before, and independent
// of, the 2-3s AI round-trip — and importing the builder from functionExplain
// would drag server-only code into the browser bundle. This module has no
// runtime dependencies (only erased `import type`s), so it bundles clean.
//
// functionExplain.ts re-exports both symbols, so its existing server-side
// importers (the explain route, the in-memory cache) are unaffected.

import type { SafetyTier } from "./refactorSafety";
import type { FnMarker, FileChips } from "./sourceAnnotations";

/** The deterministic signals we hand the model alongside the source — the
 *  grounding frame. Every field traces back to an existing analysis pass
 *  (the code graph's functions, computeRefactorSafety, the hotspot list). */
export interface FunctionSignals {
  path: string;
  name: string;
  /** 1-indexed display line of the function's start. */
  line: number;
  complexity: number;
  /** Vs the previous snapshot: new / modified / null (unchanged or no history). */
  changed: "new" | "modified" | null;
  /** Structurally identical copies elsewhere (twins). */
  duplicateCount: number;
  /** Resolved call sites into this function (function-level fan-in). */
  callerCount: number;
  /** File-level refactor-safety tier, or null for a test/unclassified file. */
  fileTier: SafetyTier | null;
  /** Does a test file reach this file at all? null when not meaningfully testable. */
  fileTested: boolean | null;
  /** Files that import or call into this file. */
  fileFanIn: number;
  /** Commits touching this file (git hotspot), or null with no history. */
  churn: number | null;
  /** authors === 1 — the bus-factor signal. */
  soloAuthor: boolean;
}

/** Reshape a function's already-computed marker + its file's chips into the flat
 *  signal set we hand the model. Pure — no new signal is invented. Deterministic
 *  over its inputs, so the client and the server produce the same signals for the
 *  same (path, marker, chips). */
export function buildFunctionSignals(
  path: string,
  marker: FnMarker,
  chips?: FileChips | null,
): FunctionSignals {
  return {
    path,
    name: marker.name || "(anonymous)",
    line: marker.startRow + 1,
    complexity: marker.complexity,
    changed: marker.changed ?? null,
    duplicateCount: marker.duplicates?.length ?? 0,
    callerCount: marker.callers?.length ?? 0,
    fileTier: chips?.tier ?? null,
    fileTested: chips?.tested ?? null,
    fileFanIn: chips?.fanIn ?? 0,
    churn: chips?.churn ?? null,
    soloAuthor: chips?.authors === 1,
  };
}
