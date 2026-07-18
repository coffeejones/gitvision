import type { CodeGraph } from "./types";

export interface CallResolution {
  /** Call sites resolved to a specific target function definition. */
  resolved: number;
  /** All call sites the parsers found. */
  total: number;
  /** resolved / total, in 0..1 (0 when there are no calls). */
  rate: number;
}

/** How many of the analyzed call sites resolved to a definition, and how many
 *  didn't. The unresolved ones are dynamic dispatch — duck typing,
 *  metaprogramming, calls into libraries/stdlib — that static analysis cannot
 *  pin to a target without running the code. The call graph (and everything
 *  built on it: blast radius, fan-in/out) uses only the resolved calls: they're
 *  high-confidence, but the graph is not exhaustive, and coverage is lower on
 *  dynamic languages. Surfacing this rate keeps the coverage honest rather than
 *  implying the graph is complete. */
export function computeCallResolution(cg: CodeGraph): CallResolution {
  const total = cg.calls.length;
  let resolved = 0;
  for (const e of cg.calls) {
    if (e.toFile && e.toFunction) resolved++;
  }
  return { resolved, total, rate: total > 0 ? resolved / total : 0 };
}
