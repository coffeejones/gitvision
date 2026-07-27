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
// file, the function and the framing are all deliberate. `splitTopLevel` is a
// sixteen-line parser that splits on top-level commas, so a stranger reads it
// in one pass, and it fits the column without a horizontal scrollbar: the pane
// holds about 57 characters at 12.5px, and a wider slice renders clipped, which
// is exactly the sort of thing that makes a still look broken.
//
// It was chosen for what the analyzer says about it, not despite it. The body
// exists TWICE in our own codebase and no test reaches it, so three chips light
// up and all three are mild criticism of us. That demonstrates more than a
// polished green panel would, because a green panel proves nothing and this is
// precisely the work the product exists to do.
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
  path: "lib/intelligence/classCanvas.ts",
  commit: "eb63f5e",
  lang: "ts",
  fn: { name: "splitTopLevel", line: 385 },
  firstLine: 385,
  // Verbatim from the file at that commit. Do not reformat it to fit — if it
  // stops fitting, choose a different slice rather than editing the code.
  code: `function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "[") depth++;
    else if (c === ">" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}`,
  signals: {
    // codeGraph.functions[] entry for this function.
    complexity: 8,
    // Called from classCanvas.ts and classDiagram.ts — 2 distinct files.
    callerCount: 2,
    // One twin: lib/intelligence/classDiagram.ts:555 has a byte-identical body
    // (bodyHash 5528c74cd3e84178). Two copies exist, so one is a twin.
    duplicateCount: 1,
    // Nothing in codeGraph.testFiles calls it.
    fileTested: false,
  },
  provenance:
    "Transcribed from the stored analysis of coffeejones/gitvision (session 6xw0IjzqRh: 1,752 functions, 24,907 call edges). Re-derive after any change to lib/intelligence/classCanvas.ts.",
};
