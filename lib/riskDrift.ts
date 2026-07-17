// Risk drift (Arc 3) — files whose blast reach grew meaningfully between two
// snapshots ("auth.ts blast grew 12 → 31 files since May 3"). This is the
// temporal signal the verdict grade can miss: a file can quietly become far
// more load-bearing without any department flipping its vote. Wired into the
// Watch monitor so a growing blast radius can independently trigger an alert.
//
// Pure over two CodeGraphs (client-safe): diffs the per-file fan-in maps from
// lib/impact.ts.
//
// Analyzer-version caveat (KNOWN LIMITATION): the two snapshots being diffed
// come from different sweeps — `prev` is stored, `newSnap` is freshly analyzed —
// so a parser upgrade between them (e.g. a language moving from the regex
// fallback to a tree-sitter plugin) can resolve more call edges and inflate
// fan-in without the code changing. The growth floor dampens small jumps but
// does NOT distinguish real coupling growth from an analyzer change. The proper
// fix is to stamp a coarse analyzer-version onto each snapshot and skip the
// first cross-version diff; until then, treat a large one-off jump right after
// a deploy with suspicion. Tracked as follow-up.

import type { CodeGraph } from "./codeAnalysis/types";
import { fileFanIn } from "./impact";
import { cmpStr } from "./deterministicSort";

export interface RiskDrift {
  /** Repo-relative path of the file whose blast reach grew. */
  file: string;
  /** Direct dependents in the previous snapshot (0 if it had none / is new). */
  from: number;
  /** Direct dependents in the current snapshot. */
  to: number;
  /** to - from. Always >= the growth floor for a reported drift. */
  delta: number;
}

/** "Load-bearing now" floor — matches refactorSafety's HIGH_FANIN, so drift
 *  reporting and the safety radar agree on what counts as load-bearing. */
const LOAD_BEARING = 8;

/** Files whose direct fan-in grew meaningfully. A file qualifies when it is
 *  load-bearing now (>= LOAD_BEARING dependents) AND grew by at least 4, scaled
 *  up for already-large files (25% of the prior count) so a 40 → 44 wobble on a
 *  huge hub doesn't register while a 12 → 31 jump does. Sorted by growth. */
export function computeRiskDrift(
  prevCg: CodeGraph,
  newCg: CodeGraph,
  limit = 5
): RiskDrift[] {
  const prev = fileFanIn(prevCg);
  const curr = fileFanIn(newCg);

  const drifts: RiskDrift[] = [];
  for (const [file, to] of curr) {
    if (to < LOAD_BEARING) continue;
    const from = prev.get(file) ?? 0;
    const delta = to - from;
    const floor = Math.max(4, Math.ceil(from * 0.25));
    if (delta < floor) continue;
    drifts.push({ file, from, to, delta });
  }

  drifts.sort(
    (a, b) => b.delta - a.delta || b.to - a.to || cmpStr(a.file, b.file)
  );
  return drifts.slice(0, Math.max(0, limit));
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** Compact one-liner for the Watch email, e.g.
 *  "auth.ts blast 12→31 · session.ts 8→19". */
export function formatRiskDrift(drifts: RiskDrift[]): string {
  return drifts
    .map((d) => `${baseName(d.file)} blast ${d.from}→${d.to}`)
    .join(" · ");
}
