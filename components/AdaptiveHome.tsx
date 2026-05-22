"use client";

// Adaptive home (v0.69 / C3 polish + v0.76 login-required model).
//
// Decides which top-level layout to render based on the caller's
// account state:
//
//   - Logged-out OR logged-in with 0 owned sessions → MarketingHome
//     (hero + demo cards as the headline lead-in + feature grid +
//      footer). The pitch surface that converts new visitors.
//   - Logged-in with 1+ owned sessions → WorkspaceHome (input bar
//     + ranked dashboard cards). Returning users' home.
//
// Pre-hydration we trust the server-decided `initialLayout`, so the
// first paint matches what the user will see (no flash).
//
// Anonymous session creation was removed in v0.76. Sessions are
// always bound to a user account; the cookie ownerId is no longer
// used as a soft-ownership claim. Legacy sessions on disk that pre-
// date this remain reachable by direct URL but don't surface in
// workspace listings.

import { useEffect, useState } from "react";
import { filterSessionsByUser } from "@/lib/ownerId";
import { authClient } from "@/lib/authClient";
import {
  sortWorkspaceByPriority,
  type WorkspaceSummary,
} from "@/lib/intelligence/workspaceTypes";
import type { DemoCard } from "@/lib/intelligence/demoCard";
import type { SessionSummary } from "@/lib/types";
import { type DemoRepo } from "@/components/RepoInputForm";
import { MarketingHome } from "@/components/MarketingHome";
import { SessionSearchPalette } from "@/components/SessionSearchPalette";
import { WorkspaceHome } from "@/components/WorkspaceHome";

interface Props {
  demoRepos: DemoRepo[];
  demoSessions: Record<string, string>;
  /** Rich DemoCard payload (WorkspaceSummary + scale stats) for each
   *  pre-built demo session, keyed by repoFullName. Lets the demo
   *  cards on the landing show real headline findings AND the scale
   *  of analysis (files, functions, hotspots) — D4 Pass 2 polish. */
  demoCards: Record<string, DemoCard>;
  initialSessions: SessionSummary[];
  workspaceSummaries: WorkspaceSummary[];
  /** Total session count on disk owned by the caller. Used by
   *  WorkspaceHome's "showing N of M" truncation hint. */
  totalOnDisk: number;
  /** Server-decided initial layout — "workspace" when the caller is
   *  logged in and owns sessions, "marketing" otherwise. Server reads
   *  the Better Auth session so the first paint matches what the
   *  client computes post-hydration. */
  initialLayout: "marketing" | "workspace";
  /** Server-decided auth state. Forwarded to MarketingHome so its
   *  hero variant (demos vs LandingPanel) matches the first paint.
   *  Post-hydration we recompute via useSession() in case the user
   *  has signed in/out since the page loaded. */
  initialLoggedIn: boolean;
}

export function AdaptiveHome({
  demoRepos,
  demoSessions,
  demoCards,
  initialSessions,
  workspaceSummaries,
  totalOnDisk,
  initialLayout,
  initialLoggedIn,
}: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    setHydrated(true);
  }, []);

  // ⌘K / Ctrl+K opens the session-search palette. Listener lives at
  // the AdaptiveHome level so it's active on both layouts — the
  // palette short-circuits to a helpful empty state if the visitor
  // has no sessions to search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Recompute owned client-side once hydrated. The server already
  // filtered `initialSessions` to the caller's own sessions (so the
  // pre-hydration paint of WorkspaceHome doesn't flash other users'
  // data — bug fixed v0.76 polish). This re-filter exists as a
  // defensive net in case the client's auth state diverges from
  // the server's (e.g. user just logged in via a popup); on the
  // happy path it's a no-op.
  const visibleSessions = hydrated
    ? filterSessionsByUser(initialSessions, userId)
    : [];

  const palette = (
    <SessionSearchPalette
      sessions={visibleSessions}
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
    />
  );

  // Pre-hydration: trust the server-decided layout.
  if (!hydrated) {
    if (initialLayout === "workspace") {
      const sorted = sortWorkspaceByPriority(workspaceSummaries);
      return (
        <>
          <WorkspaceHome summaries={sorted} totalOnDisk={totalOnDisk} />
          {palette}
        </>
      );
    }
    return (
      <>
        <MarketingHome
          demoRepos={demoRepos}
          demoSessions={demoSessions}
          demoCards={demoCards}
          loggedIn={hydrated ? userId !== null : initialLoggedIn}
        />
        {palette}
      </>
    );
  }

  // Post-hydration: client-state drives layout.
  if (visibleSessions.length === 0) {
    return (
      <>
        <MarketingHome
          demoRepos={demoRepos}
          demoSessions={demoSessions}
          demoCards={demoCards}
          loggedIn={hydrated ? userId !== null : initialLoggedIn}
        />
        {palette}
      </>
    );
  }

  // Owner-filtered + priority-sorted summaries. We re-sort client-
  // side because the server-side rank was over the unfiltered list;
  // dropping foreign sessions can change the order.
  const visibleIds = new Set(visibleSessions.map((s) => s.id));
  const visibleSummaries = sortWorkspaceByPriority(
    workspaceSummaries.filter((s) => visibleIds.has(s.id))
  );

  // Edge case: visibleSessions has entries but workspaceSummaries
  // doesn't cover them (e.g. they fell outside the server-side cap).
  // Fall back to marketing in that case — workspace with zero cards
  // would be confusing.
  if (visibleSummaries.length === 0) {
    return (
      <>
        <MarketingHome
          demoRepos={demoRepos}
          demoSessions={demoSessions}
          demoCards={demoCards}
          loggedIn={hydrated ? userId !== null : initialLoggedIn}
        />
        {palette}
      </>
    );
  }

  return (
    <>
      <WorkspaceHome
        summaries={visibleSummaries}
        totalOnDisk={visibleSessions.length}
      />
      {palette}
    </>
  );
}
