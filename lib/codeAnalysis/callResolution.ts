import type { CodeGraph } from "./types";
import { isTestFile } from "./testCoverage";

export interface CallResolution {
  /** Call sites resolved to a specific target function definition. */
  resolved: number;
  /** All call sites the parsers found. */
  total: number;
  /** resolved / total, in 0..1 (0 when there are no calls). */
  rate: number;
}

/** Raw resolved-over-total across every call site the parsers saw.
 *
 *  DO NOT SHOW THIS TO A USER AS A COVERAGE OR ACCURACY FIGURE. Most call edges
 *  in any real file point at libraries and language builtins — measured on this
 *  repo, 72% of all edges are names like `expect`, `it`, `map`, `push`, `Map`.
 *  Those SHOULD stay unresolved: there is no own-repo function to point them at.
 *  Rendering this rate undersells the analysis by roughly ten times (zod: 19%
 *  here against 96% own-call), and it did exactly that on the Code tab until
 *  computeOwnCallResolution below took its place.
 *
 *  It remains useful as a raw denominator — "N call sites seen" — and for
 *  debugging the resolver. Nothing more. */
export function computeCallResolution(cg: CodeGraph): CallResolution {
  const total = cg.calls.length;
  let resolved = 0;
  for (const e of cg.calls) {
    if (e.toFile && e.toFunction) resolved++;
  }
  return { resolved, total, rate: total > 0 ? resolved / total : 0 };
}

export interface OwnCallResolution {
  /** Own-code calls that resolved. */
  ownResolved: number;
  /** Unresolved calls we have EVIDENCE were aimed at our own code. */
  ownMissed: number;
  /** ownResolved + ownMissed — every production call that pointed at our code. */
  ownTotal: number;
  /** Share of own-code calls that resolved, 0-100. At least this good, never worse. */
  ownPct: number;
}

export interface OwnCallResolutionOptions {
  /** Drop calls made FROM test files, on both sides of the ratio. Default true:
   *  a test calling a plugin-interface method that exists once per plugin is
   *  ambiguous by construction, not a resolver defect. */
  excludeTests?: boolean;
}

/** Of the calls that name something this repo actually defines, how many did we
 *  resolve? THIS is the number worth showing.
 *
 *  A NAME MATCH ALONE IS NOT EVIDENCE, and that distinction is the whole
 *  function. `request.POST.get()` names `get`, and any Django repo defines a
 *  `get` somewhere — counting name collisions scored pygoat at 25% when 74 of
 *  its 103 "misses" were dict and ORM calls the resolver was right to refuse.
 *  Python is worst hit (`get`, `save`, `filter`, `update` are simultaneously
 *  ubiquitous library methods and ordinary function names) but nothing here is
 *  language-specific.
 *
 *  Evidence means one of:
 *    - a bare call (no receiver) naming a function we define
 *    - a receiver typed as a class we define — that one should have resolved
 *
 *  Known trade: when a plugin fails to type a receiver that really was ours, the
 *  miss goes uncounted, so this errs slightly optimistic. That is the right
 *  direction for a number shown as a confidence signal, and the honest
 *  alternative — counting things we cannot show are ours — was wrong by a factor
 *  of four.
 *
 *  Lives here rather than inside buildFlowIndex so the Code tab can read it
 *  without building a whole adjacency map, and so there is ONE implementation:
 *  flowTrace delegates to this. Two copies of the same arithmetic is how the
 *  critical-count bug survived in two files at once. */
export function computeOwnCallResolution(
  cg: CodeGraph,
  opts: OwnCallResolutionOptions = {},
): OwnCallResolution {
  const excludeTests = opts.excludeTests ?? true;

  // Every function name this repo defines — lets us tell "we failed to resolve
  // this" from "there was nothing here to resolve".
  const ownNames = new Set(cg.functions.map((f) => f.name));
  // Classes/structs this repo defines. A receiver typed as one of these is a
  // call at our own code; a receiver typed as anything else is a library.
  const ownContainers = new Set<string>();
  for (const fn of cg.functions) {
    if (fn.containerType) ownContainers.add(fn.containerType);
  }

  let ownResolved = 0;
  let ownMissed = 0;
  for (const c of cg.calls) {
    if (!c.fromFunction) continue; // module-scope call, not attributable
    const fromTest = excludeTests && isTestFile(c.fromFile);
    if (c.toFile && c.toFunction) {
      if (!fromTest) ownResolved++;
      continue;
    }
    if (
      ownNames.has(c.calleeName) &&
      !fromTest &&
      (!c.hasReceiver ||
        (c.calleeType !== undefined && ownContainers.has(c.calleeType)))
    ) {
      ownMissed++;
    }
  }

  const ownTotal = ownResolved + ownMissed;
  return {
    ownResolved,
    ownMissed,
    ownTotal,
    ownPct: ownTotal > 0 ? Math.round((ownResolved / ownTotal) * 100) : 0,
  };
}
