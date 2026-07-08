// Request-scoped session helpers for the App Router (server-only).
//
// The session layout and each page both need the session, and on the Overview
// route both also compute the drift report. React's cache() memoizes across the
// Server Component tree for a single request, so wrapping these here dedups the
// fs read + parse AND the drift computation between layout.tsx and page.tsx —
// instead of each independently reading the (potentially large) session JSON and
// re-walking the baseline graph.
//
// Keyed on the session id (a stable string), so every caller in the same render
// shares one result. The raw getSession stays untouched for non-React callers
// (the Watch cron, the MCP server), where cache() would be a no-op anyway.

import { cache } from "react";
import { getSession } from "./storage";
import { computeDriftTrends, type DriftReport } from "./driftMetrics";

/** getSession, deduped across the layout + page of one session-route render. */
export const getSessionCached = cache(getSession);

/** The multi-sweep drift report for a session, deduped across the toolbar
 *  (layout) and the Overview panel (page) so the baseline graph is walked once. */
export const getDriftReport = cache(
  async (id: string): Promise<DriftReport> => {
    const session = await getSessionCached(id);
    return session
      ? computeDriftTrends(session.snapshots)
      : { hasBaseline: false, sweeps: 0, trends: [] };
  },
);
