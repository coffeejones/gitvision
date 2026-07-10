// Change-blast types (Arc 5 — Change-Time Blast). Client-safe: no analysis
// imports, so the preview UI can render these without pulling the engine in.

import type { SafetyTier } from "../refactorSafety";

export type ChangeKind = "added" | "removed" | "modified";

/** One file the diff touches, with its blast evidence (from the refactor-safety
 *  engine on the relevant graph). */
export interface ChangedFileBlast {
  file: string;
  kind: ChangeKind;
  /** Safety tier of the file (load-bearing … safe). Removed files are tiered
   *  against the BASE graph — what depended on them before deletion. */
  tier: SafetyTier;
  /** Distinct files that import/call into this one — how far a change ripples. */
  dependents: number;
  untestedDependents: number;
  complexity: number;
  isTest: boolean;
  /** Test files that statically reach this file (the tests worth running). */
  testsToRun: string[];
}

export interface ChangeBlastReport {
  /** False when a code graph is missing on either side — the diff can't be
   *  blast-mapped, only the aggregate deltas are available. */
  hasGraphs: boolean;
  /** Every changed file, risk-ranked (non-test first, then tier, then reach). */
  changedFiles: ChangedFileBlast[];
  /** Changed non-test files at the two highest tiers. */
  wallsTouched: string[];
  /** Changed non-test files at the load-bearing tier specifically. */
  loadBearingTouched: string[];
  /** Combined dependent-file reach across the changed files. */
  combinedDependents: number;
  functionsAdded: number;
  functionsRemoved: number;
  /** How many of the diff's files are test files. */
  testFilesChanged: number;
  /** Union of the test files that guard the changed files. */
  testsToRun: string[];
  /** Of `testsToRun`, how many were themselves changed in this diff. */
  mappedTestsUpdated: number;
  /** The reviewer's traffic light. */
  verdict: "clear" | "review" | "high-risk";
  /** One-line reviewer brief. */
  headline: string;
}
