// What the three public demo sweeps actually found — read at request time so
// the landing can show a computed finding instead of a marketing sentence.
//
// The landing's only instant proof is the pre-analyzed demo sessions, which a
// logged-out visitor can open with every panel unlocked (see isDemoSession in
// lib/demoSessions.ts). They were a 12.5px line of grey mono under the intake;
// the point of this module is to give the section that replaces it something
// true to say per repo — the SAME headline the session's own Overview shows,
// via the same pure pickHeadline(), so the landing cannot drift from the
// product.
//
// Degrades on purpose. The demo session ids are production data; on a laptop
// (and on any deploy whose volume hasn't been seeded) getSession returns null,
// and a card with no finding renders as just the repo and its link rather than
// inventing a number. Never throw: a missing demo session must not take the
// home page down.

import { getSession } from "./storage";
import { DEMO_SESSIONS } from "./demoSessions";
import { pickHeadline } from "./intelligence/headline";

export interface DemoHighlight {
  /** Short label, e.g. "zod". */
  label: string;
  /** owner/repo. */
  repo: string;
  /** Prod session id; "" when unconfigured. */
  sessionId: string;
  /** Primary language as GitHub reports it. Null when unavailable. */
  language: string | null;
  /** Star count at sweep time. Null when unavailable. */
  stars: number | null;
  /** The session's own top finding, one line. Null when unavailable. */
  finding: string | null;
}

/** How long a computed set stays fresh. The inputs only change when the demo
 *  sessions are re-swept by hand, so this can be generous. */
const TTL_MS = 15 * 60_000;

let cached: { at: number; value: DemoHighlight[] } | null = null;
/** Shared promise for an in-progress load, so N concurrent cold requests do
 *  one read between them rather than N. */
let inFlight: Promise<DemoHighlight[]> | null = null;

/** Load every configured demo, in the order the landing shows them. Demos
 *  without a session id are dropped — they would link into the signup flow,
 *  which is the opposite of what this section is for.
 *
 *  CACHED, and not as a micro-optimisation. The home page is force-dynamic, so
 *  this runs per visit, and a session JSON carries the whole code graph: the
 *  zod sweep alone is 55 MB on disk, and reading the three plus pickHeadline
 *  measured 141-167 ms and +106 MB of heap per call on this machine (modules
 *  already loaded, so that is the read, not the import). Uncached, every
 *  visitor to the landing would pay it. React's cache() (lib/sessionCache.ts)
 *  cannot help — it dedups within ONE render, and the cost here is per request.
 *
 *  Failures are cached too. A missing or unreadable session yields cards with
 *  no finding, and re-reading a 55 MB file on every request to rediscover that
 *  is the worst of both. */
export async function loadDemoHighlights(): Promise<DemoHighlight[]> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  if (inFlight) return inFlight;

  const configured = DEMO_SESSIONS.filter((d) => d.sessionId);
  inFlight = Promise.all(configured.map(loadOne))
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** TEST-ONLY. Drops the memo so cases don't leak into each other. */
export function _resetDemoHighlightsCache() {
  cached = null;
  inFlight = null;
}

async function loadOne(demo: {
  label: string;
  repo: string;
  sessionId: string;
}): Promise<DemoHighlight> {
  const bare: DemoHighlight = {
    label: demo.label,
    repo: demo.repo,
    sessionId: demo.sessionId,
    language: null,
    stars: null,
    finding: null,
  };

  try {
    const session = await getSession(demo.sessionId);
    const snap = session?.snapshots?.[session.snapshots.length - 1];
    if (!snap) return bare;

    // pickHeadline is the same function the session Overview renders, so this
    // line is not a second, drifting description of the repo — it is the repo's
    // finding, quoted.
    const headline = pickHeadline(snap);
    return {
      ...bare,
      language: snap.repo?.language ?? null,
      stars: typeof snap.repo?.stars === "number" ? snap.repo.stars : null,
      finding: headline.primary || null,
    };
  } catch {
    // Unreadable or malformed session file. The landing still renders.
    return bare;
  }
}

/** Compact star count — "71.6k" rather than "71583", which reads as noise at
 *  card size. */
export function formatStars(stars: number): string {
  if (stars < 1000) return String(stars);
  const k = stars / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}
