// The Faultline blast shown on the landing page — computed, then pinned.
//
// The screenshot this replaces was the one carrying the unstyled white React
// Flow panel for weeks, and it had to be patched by hand rather than re-shot
// because the preview pane cannot capture at 1600px. Rendering the diagram
// removes both problems at once: nothing to photograph, nothing to go stale.
//
// It is drawn as inline SVG, NOT React Flow. The product's canvas is a client
// component that pulls the whole library in; the landing needs the picture, not
// the pan-and-zoom, and an SVG ships as markup with no JavaScript at all. The
// layout constants below are the canvas's own (COL_W, ROW_H, ROWS_PER_COL, card
// size) so the composition reads the same rather than merely similar.
//
// WHAT IS CHOSEN, AND WHAT IS NOT
//
// The epicenter is chosen: lib/db/index.ts is the database layer, so a stranger
// understands why deleting it is frightening before reading a single number,
// and the blast is large enough to look serious while still fitting three
// columns.
//
// The BLAST is not chosen. The file list, the break count and the untested
// count below are the output of computeBlastRadius(graph, path, { maxHops: 1 })
// classified exactly the way lib/shadowGraph/simulate.ts classifies it —
// `untested: !isTestFile(p) && !tested.has(p)`, with deriveTestedFiles over the
// same graph. Re-derive after any change to the imports around lib/db; do not
// edit the numbers to look worse or better than they are.
//
// Hop 1 only, deliberately, and the same reason the product gives: a hop-2 file
// imports the broken file, not the deleted one, so it does not necessarily
// break. "15 files break" stays a claim we can defend.

export interface BlastCasualty {
  path: string;
  /** No test reaches it — a break with no safety net. */
  untested: boolean;
}

export interface PinnedBlast {
  repo: string;
  epicenter: string;
  /** Hops included. One, and the headline depends on it. */
  hops: number;
  casualties: BlastCasualty[];
  provenance: string;
}

export const LANDING_BLAST: PinnedBlast = {
  repo: "coffeejones/gitvision",
  epicenter: "lib/db/index.ts",
  hops: 1,
  // Ordered untested-first, exactly as computeAffectedFiles orders them, so the
  // diagram's reading order is the product's risk order.
  casualties: [
    { path: "app/(workspace)/account/billing/page.tsx", untested: true },
    { path: "app/(workspace)/account/connections/page.tsx", untested: true },
    { path: "app/(workspace)/account/security/page.tsx", untested: true },
    { path: "app/api/admin/reset-billing/route.ts", untested: true },
    { path: "app/api/billing/cancel/route.ts", untested: true },
    { path: "app/api/billing/change-plan/route.ts", untested: true },
    { path: "app/api/billing/portal/route.ts", untested: true },
    { path: "app/api/polar/webhook/route.ts", untested: true },
    { path: "lib/auth.ts", untested: true },
    { path: "lib/billing/refreshQuota.ts", untested: true },
    { path: "lib/githubUserToken.ts", untested: true },
    { path: "lib/watches.ts", untested: true },
    { path: "lib/billing/gates.ts", untested: false },
    { path: "lib/metrics.ts", untested: false },
    { path: "lib/watchMonitor.ts", untested: false },
  ],
  provenance:
    "computeBlastRadius(graph, 'lib/db/index.ts', { maxHops: 1 }) over the stored analysis of coffeejones/gitvision (session 6xw0IjzqRh), classified with deriveTestedFiles + isTestFile the way lib/shadowGraph/simulate.ts does.",
};

/** Counts the headline quotes. Derived, never written down twice — a hand-typed
 *  total is the first thing to drift when a casualty is added or removed. */
export function blastCounts(b: PinnedBlast = LANDING_BLAST) {
  return {
    breaks: b.casualties.length,
    untested: b.casualties.filter((c) => c.untested).length,
  };
}
