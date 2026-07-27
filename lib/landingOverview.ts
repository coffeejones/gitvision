// The Overview screen shown on the landing — the same 2026-07-27 sweep of
// pallets/flask that lib/landingSecurity.ts pins, read through the two blocks
// that carry the promise: what the sweep FOUND, and how the repo scores.
//
// LIKE THE SECURITY SHOT, THIS IS INPUT ONLY. The landing mounts the product's
// own <HeadlineFinding> and <HealthSummary>; the severity colour, the icon, the
// CTA wording, the tile layout and the status styling are all still theirs. So
// there is nothing here to keep in step with the product — only numbers to keep
// true.
//
// WHY THE OUTPUT AND NOT THE SNAPSHOT. pickHeadline and summarizeHealth look
// like pure functions you could feed a small object; they are not. summarizeHealth
// reaches through extractHealthSignals into eighteen snapshot fields, and both
// have a degenerate branch that fires on anything hand-sized: no codeGraph and
// the headline becomes "Code analysis not available", six unknown dimensions and
// HealthSummary returns NULL and the strip disappears from the hero. So they
// were run once, for real, and their results transcribed. 1 KB instead of 24 MB.
//
// WHAT IS NOT HERE, AND WHY. The product's Overview also carries a metadata row
// (stars / forks / age / contributors / velocity / branch) rendered by StatGrid.
// It is omitted rather than approximated: StatGrid reads contributors.length and
// averages commitActivity across its whole length, so an honest render needs the
// real 100-element contributor list and all 678 weekly buckets. Trimming either
// keeps the pill but changes what its number MEANS — a 14-week average under a
// label the product computes over a lifetime — and inventing contributor records
// to make one pill read "100" is worse than leaving the row out. The two blocks
// below are the ones a stranger reads anyway.

import type { Headline } from "./intelligence/headline";
import type { DimensionSummary } from "./intelligence/healthSummary";

/** Same sweep, same session, as lib/landingSecurity.ts. */
export const LANDING_OVERVIEW_PROVENANCE =
  "pickHeadline() and summarizeHealth() run against analyzeRepo('pallets','flask') on 2026-07-27, transcribed verbatim. Re-derive after any change to lib/signals.ts, lib/intelligence/* or the analyzer; do not edit a status or a sentence by hand.";

export const LANDING_OVERVIEW_REPO = {
  fullName: "pallets/flask",
  url: "https://github.com/pallets/flask",
  description: "The Python micro framework for building web applications.",
};

/** The sweep's own top finding. Not the flattering one — flask's most notable
 *  result is that ten of its complex functions have no test reaching them. */
export const LANDING_HEADLINE: Headline = {
  kind: "many-untested-hotspots",
  severity: "warning",
  primary: "10 untested hotspots — most complex is Blueprint.register",
  detail:
    "Cyclomatic 22 in src/flask/sansio/blueprints.py. No test file calls this function directly.",
  ctaLink: "code?focus=untested",
  ctaLabel: "View untested hotspots",
};

/** All six dimensions, in the product's order, with the product's own evidence
 *  sentences. Five healthy and one critical is what the analyzer returned — a
 *  strip edited to look either greener or redder would be the fake version of
 *  the one panel on this page whose whole claim is that it is computed. */
export const LANDING_HEALTH: DimensionSummary[] = [
  {
    id: "activity",
    label: "Activity",
    status: "healthy",
    statusLabel: "Healthy",
    detail: "Only 0% of recent churn is metadata/config",
    signalCount: 1,
  },
  {
    id: "team",
    label: "Team",
    status: "healthy",
    statusLabel: "Healthy",
    detail: "8 folders have 3+ recent contributors",
    signalCount: 2,
  },
  {
    id: "code",
    label: "Code",
    status: "critical",
    statusLabel: "Critical",
    detail:
      "17 file pairs across different top-level folders change together frequently",
    signalCount: 4,
  },
  {
    id: "pr-flow",
    label: "PR flow",
    status: "healthy",
    statusLabel: "Healthy",
    detail: "22 merged vs 5 open among human-authored PRs",
    signalCount: 2,
  },
  {
    id: "deps",
    label: "Dependencies",
    status: "healthy",
    statusLabel: "Healthy",
    detail: "31 packages analyzed across pypi",
    signalCount: 1,
  },
  {
    id: "hygiene",
    label: "Hygiene",
    status: "healthy",
    statusLabel: "Healthy",
    detail:
      "All 21 action references are pinned to a commit and every one of the 5 workflows declares its token scope",
    signalCount: 1,
  },
];
