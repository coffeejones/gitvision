"use client";

// Adaptive home (v0.69 / C3 polish).
//
// Reads ownerId from localStorage and decides which top-level
// layout to render:
//
//   - 0 owned sessions → MarketingHome (hero + form + demos +
//     feature grid + footer). What HN/Reddit first-timers see.
//   - 1+ owned sessions → WorkspaceHome (input bar + ranked
//     dashboard cards). What returning power-users see.
//
// Pre-hydration we render MarketingHome — it matches what the
// server pre-renders so there's no flash. Once localStorage is
// readable, we swap to WorkspaceHome if applicable.
//
// Why one switcher (vs. just enhancing LandingPanel): the two
// layouts have entirely different page chrome (hero / no hero,
// feature grid / no feature grid, footer / no footer). Co-locating
// the switch keeps each layout component focused on its own job
// and makes the "marketing vs power-user" decision visible in one
// place.

import { useEffect, useState } from "react";
import { filterSessionsByOwner, getOrCreateOwnerId } from "@/lib/ownerId";
import {
  sortWorkspaceByPriority,
  type WorkspaceSummary,
} from "@/lib/intelligence/workspaceTypes";
import type { SessionSummary } from "@/lib/types";
import { type DemoRepo } from "@/components/RepoInputForm";
import { MarketingHome } from "@/components/MarketingHome";
import { SessionSearchPalette } from "@/components/SessionSearchPalette";
import { WorkspaceHome } from "@/components/WorkspaceHome";

interface Props {
  demoRepos: DemoRepo[];
  demoSessions: Record<string, string>;
  initialSessions: SessionSummary[];
  workspaceSummaries: WorkspaceSummary[];
  /** Total session count on disk (>= workspaceSummaries.length when
   *  the cap kicked in). Used by WorkspaceHome's "showing N of M"
   *  truncation hint. */
  totalOnDisk: number;
  /** Server-decided initial layout based on the gv_owner_id cookie.
   *  When the cookie matches a session in `initialSessions`, server
   *  passes "workspace" so we skip the marketing-flash on hydration.
   *  Defaults to "marketing" for first-time visitors and legacy
   *  users without the cookie populated yet. */
  initialLayout: "marketing" | "workspace";
}

export function AdaptiveHome({
  demoRepos,
  demoSessions,
  initialSessions,
  workspaceSummaries,
  totalOnDisk,
  initialLayout,
}: Props) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    setOwnerId(getOrCreateOwnerId());
    setHydrated(true);
  }, []);

  // ⌘K / Ctrl+K opens the session-search palette. Listener lives at
  // the AdaptiveHome level so it's active on both the marketing and
  // workspace layouts — the palette itself short-circuits to a
  // helpful empty state if the visitor has no sessions to search.
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

  // The palette renders on top of whichever layout is active. We
  // build the searchable session list before branching so the
  // shortcut works identically on marketing and workspace surfaces.
  const visibleSessions = hydrated
    ? filterSessionsByOwner(initialSessions, ownerId)
    : [];

  const palette = (
    <SessionSearchPalette
      sessions={visibleSessions}
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
    />
  );

  // Pre-hydration: trust the server-decided layout. The server read
  // gv_owner_id from cookies and matched it against the loaded
  // sessions — when that produced "workspace" we render the workspace
  // shell directly, no marketing flash. Legacy users without the
  // cookie (pre-v0.69) still see one flash on first visit while
  // getOrCreateOwnerId populates the cookie; subsequent visits are
  // silent.
  if (!hydrated) {
    if (initialLayout === "workspace") {
      // Pre-sort here too — same logic the post-hydration path uses
      // below — so the server-rendered shell shows cards in the
      // same order they'll appear after hydration. Avoids a re-sort
      // shuffle when the client takes over.
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
          initialSessions={initialSessions}
        />
        {palette}
      </>
    );
  }

  if (visibleSessions.length === 0) {
    return (
      <>
        <MarketingHome
          demoRepos={demoRepos}
          demoSessions={demoSessions}
          initialSessions={initialSessions}
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
          initialSessions={initialSessions}
        />
        {palette}
      </>
    );
  }

  // Post-hydration: override the server's totalOnDisk with the
  // precise client-side filtered count. Server can only see what's
  // in the cookie; client knows the authoritative owner-id from
  // localStorage and may have a different (newer / corrected) view.
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
