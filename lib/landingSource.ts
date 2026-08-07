// The code shown on the landing page — pinned, and every number beside it real.
//
// The landing used to mount a PNG of the Source view. A screenshot is fixed at
// one resolution, cannot reflow on a phone, goes stale silently, and carried a
// rendering bug for weeks without anyone noticing (the white React Flow panel).
// This renders the same view from source instead: Shiki server-side, the
// product's own gutter geometry, the product's own evidence chips.
//
// WHAT IS CHOSEN, AND WHAT IS NOT
//
// Choosing is the point — this is the best example out of a hundred, the way a
// product photographer picks the best one off the line. The repository, the
// file, the function and the framing are all deliberate. `lookupVariableType`
// is twelve lines, sixty characters at its widest, and a stranger reads it in
// one pass: walk the scope stack, then the class fields, then give up.
//
// It was chosen for what the analyzer says about it, not despite it. That body
// exists FIVE TIMES in our own codebase — byte-identical in the C#, Java,
// JavaScript, PHP and Python plugins — seven files call it, and no test reaches
// any copy. Every chip is mild criticism of us, which demonstrates more than a
// polished green panel ever could: a green panel proves nothing, and finding a
// generic scope walk copy-pasted into five language plugins is precisely the
// work the product exists to do.
//
// The NUMBERS are not chosen. Complexity, caller count and duplicate count are
// what the analyzer computed for this exact function, transcribed from a real
// sweep with provenance recorded per field. If the code changes they must be
// re-derived, not nudged to look better — that is the whole difference between
// styling the shot and faking it, and both the /security page and the
// "computed, never generated" line depend on which side of it we stay on.
//
// Our own repository on purpose: no third-party licence question, and the
// existing screenshots already dogfood.

export interface PinnedSource {
  repo: string;
  path: string;
  /** Commit the slice was taken from, so the excerpt is reproducible. */
  commit: string;
  /** Extension for the highlighter — see LANG_BY_EXT in lib/highlight.ts. */
  lang: string;
  /** The function the evidence chips describe. */
  fn: { name: string; line: number };
  /** True line number of the slice's first line, so the gutter is honest. */
  firstLine: number;
  code: string;
  /** The model's reading of this exact function, GENERATED not written — see
   *  `reading.provenance`. Kept alongside the signals it was given so the two
   *  can never describe different functions. */
  reading: {
    does: string;
    risk: string;
    suggestion: string | null;
    model: string;
    generatedAt: string;
    provenance: string;
  };
  /** Computed by the analyzer, not by us. See `provenance`. */
  signals: {
    complexity: number;
    /** Distinct FILES that call it — what the product's chip counts. */
    callerCount: number;
    /** Other functions sharing this body, i.e. copies besides this one. */
    duplicateCount: number;
    fileTested: boolean;
  };
  provenance: string;
}

export const LANDING_SOURCE: PinnedSource = {
  repo: "coffeejones/gitvision",
  path: "lib/codeAnalysis/plugins/javascript.ts",
  commit: "c68004a",
  lang: "ts",
  fn: { name: "lookupVariableType", line: 913 },
  firstLine: 913,
  // Verbatim from the file at that commit, leading indentation included — it is
  // a nested function, and the slice is compared byte-for-byte in the tests. Do
  // not reformat it to fit; choose a different slice instead.
  code: `  function lookupVariableType(name: string): string | null {
    for (let i = methodStack.length - 1; i >= 0; i--) {
      const t = methodStack[i].locals.get(name);
      if (t) return t;
    }
    const cls = currentClass();
    if (cls) {
      const t = cls.fields.get(name);
      if (t) return t;
    }
    return null;
  }`,
  // Verbatim output of lib/functionExplain.explainFunction() run against the
  // slice above with the signals below — not a sentence anyone here composed.
  // Re-run it if the code or the signals change; do not hand-edit it to read
  // better, because then it is marketing copy wearing the product's voice.
  reading: {
    does:
      "Searches a stack of method scopes and the current class for a variable's type, returning the first match or null.",
    risk:
      "The function is structurally duplicated 4 times elsewhere in the codebase, and the file containing it is not reached by tests, making it difficult to verify correctness across all copies if the logic needs to change.",
    suggestion:
      "Extract this lookup logic into a shared utility function to consolidate the 4 duplicates and reduce maintenance burden.",
    model: "claude-haiku-4-5",
    generatedAt: "2026-07-27T21:13:31.267Z",
    provenance:
      "explainFunction() on this exact slice + signals, 1,072 input / 124 output tokens. Transcribed verbatim.",
  },
  signals: {
    // codeGraph.functions[] entry for this function.
    complexity: 5,
    // Seven distinct files call it.
    callerCount: 7,
    // FIVE byte-identical copies share one bodyHash — the C#, Java, JavaScript,
    // PHP and Python plugins each hold one — so four of them are twins.
    duplicateCount: 4,
    // Nothing in codeGraph.testFiles reaches any copy.
    fileTested: false,
  },
  provenance:
    "Transcribed from the stored analysis of coffeejones/gitvision (session 6xw0IjzqRh: 1,752 functions, 24,907 call edges). Re-derive after any change to lib/codeAnalysis/plugins/javascript.ts.",
};
