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

/** The route's own no-diff orientation line, verbatim from
 *  app/session/[id]/page.tsx. It has two branches — one for a repeat visit with
 *  a diff, one for a first sweep — and the shot is a first sweep. */
export const LANDING_ORIENTATION_LINE =
  "The top finding, then six rule-based health tiles. Start with the finding, then open any card.";

/** The Workspace grid. Each `stat` is the string the route builds for that tab
 *  from this sweep — 120 hotspots, 105 files and 211 edges, 1,460 functions at
 *  7% covered, and so on. They are transcribed rather than recomputed because
 *  the route derives them inline rather than through a named function; the
 *  numbers are the sweep's, not chosen, and re-derive after any analyzer change.
 *
 *  `accent` and `warn` are the route's own flags: accent when a tab has
 *  something worth opening, warn when it has a problem. Flask's packages are
 *  clean at runtime scope, so nothing here is warned. */
export const LANDING_WORKSPACE: {
  tab: string;
  label: string;
  stat: string;
  description: string;
  accent?: boolean;
}[] = [
  {
    tab: "canvas",
    label: "Canvas",
    stat: "120 hotspots · Python",
    description: "Folder map · color by author or type · time-scrub history",
  },
  {
    tab: "imports",
    label: "Imports",
    stat: "105 files · 211 edges",
    description: "Import graph · cycles · orphaned modules",
  },
  {
    tab: "code",
    label: "Code",
    stat: "1,460 fns · 7% covered",
    description: "Blast radius · untested hotspots · structural duplicates",
    accent: true,
  },
  {
    tab: "architecture",
    label: "Architecture",
    stat: "160 classes extracted",
    description: "Class diagrams · Mermaid export · architectural intelligence",
  },
  {
    tab: "packages",
    label: "Packages",
    stat: "30 packages",
    description: "CVE-aware health for npm / Cargo / PyPI",
  },
  {
    tab: "prs",
    label: "PRs",
    stat: "200 pull requests",
    description: "Sankey of cycle-time flow · median time-to-merge",
  },
  {
    tab: "insights",
    label: "Insights",
    stat: "AI summary + health grade",
    description: "Grounded in 20 deterministic signals · zero hallucination",
  },
];

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
