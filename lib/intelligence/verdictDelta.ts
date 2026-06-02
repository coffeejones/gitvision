// Verdict delta — how a case's verdict moved between its two most recent
// snapshots. This is the "since last visit" signal the Chambers Cases
// list shows per card and aggregates into a docket summary.
//
// Pure function over two Verdict objects (+ their high-severity counts),
// mirroring lib/diff.ts's diffSnapshots pattern: no I/O, fully testable.
// diffSnapshots already covers repo ACTIVITY (commits / hotspots /
// contributors); this covers the VERDICT itself (grade / score /
// department votes / criticals), which is the movement users said they'd
// reopen the workspace to see.

import type { Verdict, DepartmentId, Vote, VerdictOutcome } from "./verdict";

/** Net direction of a verdict's movement between two snapshots. "mixed"
 *  is the score-flat-but-votes-shuffled case (one office improved while
 *  another slipped, netting zero). */
export type DeltaDirection = "improved" | "regressed" | "mixed" | "unchanged";

export interface DepartmentVoteChange {
  id: DepartmentId;
  from: Vote;
  to: Vote;
}

export interface VerdictDelta {
  /** curr.score - prev.score. Positive = the codebase improved. */
  scoreDelta: number;
  /** Letter grades, when they differ; null when the grade held. */
  grade: { from: string; to: string } | null;
  /** Overall outcome, when it differs; null when it held. */
  outcome: { from: VerdictOutcome; to: VerdictOutcome } | null;
  /** Only the departments whose vote actually moved, in canonical order. */
  departments: DepartmentVoteChange[];
  /** currCritical - prevCritical (high-severity finding count). */
  criticalDelta: number;
  direction: DeltaDirection;
}

/** Classify the movement. Score leads; a flat score is broken by the
 *  critical count (more high-sev findings = a regression even when no
 *  department flipped its vote); a flat score with shuffled votes is
 *  "mixed"; everything equal is "unchanged". */
function classify(
  scoreDelta: number,
  criticalDelta: number,
  deptChangeCount: number,
): DeltaDirection {
  if (scoreDelta > 0) return "improved";
  if (scoreDelta < 0) return "regressed";
  if (criticalDelta > 0) return "regressed";
  if (criticalDelta < 0) return "improved";
  if (deptChangeCount > 0) return "mixed";
  return "unchanged";
}

/** Diff two verdicts (+ their high-severity counts) into a VerdictDelta.
 *  prev/curr are the verdicts of a case's previous and latest snapshots. */
export function diffVerdict(
  prev: Verdict,
  curr: Verdict,
  prevCritical: number,
  currCritical: number,
): VerdictDelta {
  const scoreDelta = curr.score - prev.score;
  const grade =
    prev.grade !== curr.grade ? { from: prev.grade, to: curr.grade } : null;
  const outcome =
    prev.outcome !== curr.outcome
      ? { from: prev.outcome, to: curr.outcome }
      : null;

  // Department vote changes. Iterate curr.rulings (canonical order:
  // health, security, forensics, supply) and pair against prev by id.
  const prevVotes = new Map<DepartmentId, Vote>(
    prev.rulings.map((r) => [r.id, r.vote]),
  );
  const departments: DepartmentVoteChange[] = [];
  for (const r of curr.rulings) {
    const from = prevVotes.get(r.id);
    if (from !== undefined && from !== r.vote) {
      departments.push({ id: r.id, from, to: r.vote });
    }
  }

  const criticalDelta = currCritical - prevCritical;
  const direction = classify(scoreDelta, criticalDelta, departments.length);

  return { scoreDelta, grade, outcome, departments, criticalDelta, direction };
}
