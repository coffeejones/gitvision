// /workspace — power-user dashboard (v0.68 / C3).
//
// Cross-session view of every analyzed repo, ranked by "where should
// I focus first?". Built for users who hit the Joe-Huber pattern
// (analyzing 3+ repos in succession) — they want a dashboard, not a
// landing page.
//
// Server-side rendered: we read every session JSON, project it to a
// WorkspaceSummary, sort by criticality, and render one card per
// session. Heavy on file I/O for power-users with 20+ sessions, but
// each summary is cheap (signal extraction is pure + fast). When this
// gets slow, the cap MAX_SESSIONS_RENDERED guards against runaway
// load times and surfaces a "showing N of M" hint.
//
// Owner-id filter: WorkspaceCard list isn't filtered server-side
// because ownerId lives in localStorage (browser-only). The full
// list is rendered, but the future enhancement is a client-side
// filter that hides demo + foreign sessions per the existing v0.26
// pattern.

import { notFound } from "next/navigation";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { listSessions } from "@/lib/storage";
import {
  getWorkspaceSummaries,
  sortWorkspaceByPriority,
  type WorkspaceSummary,
} from "@/lib/intelligence/workspaceSummary";
import { STYLE, TOK } from "@/lib/theme";
import { WorkspaceCard } from "@/components/views/WorkspaceCard";
import { WorkspaceInputBar } from "@/components/views/WorkspaceInputBar";

export const dynamic = "force-dynamic";

/** Cap on cards rendered server-side. Hard limit so a power-user
 *  with hundreds of sessions doesn't trigger a multi-second TTFB.
 *  Above this, the dashboard shows the most-recent N + a hint that
 *  more exist via the search palette. */
const MAX_SESSIONS_RENDERED = 30;

export default async function WorkspaceRoute() {
  const allSessions = await listSessions();
  if (allSessions.length === 0) {
    // No sessions exist anywhere — the standard landing copy belongs
    // here. Don't show an empty grid; redirect-style guidance.
    return <EmptyState />;
  }

  // Take the most-recent N session ids (storage already sorts by
  // updatedAt desc). Anything beyond the cap goes into the "more
  // available" tail message.
  const visibleIds = allSessions
    .slice(0, MAX_SESSIONS_RENDERED)
    .map((s) => s.id);
  const summaries = await getWorkspaceSummaries(visibleIds);
  const ranked = sortWorkspaceByPriority(summaries);
  const truncated = allSessions.length > MAX_SESSIONS_RENDERED;

  return (
    <main className="px-8 py-8 flex flex-col gap-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <LayoutGrid size={14} style={{ color: TOK.accent }} />
          <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
            Workspace · {summaries.length} session
            {summaries.length === 1 ? "" : "s"}, ranked by attention
          </span>
        </div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.01em" }}
        >
          Your code dashboard
        </h1>
        <p className="text-sm" style={{ color: TOK.textMuted }}>
          One card per analyzed repo, ordered most-critical first.
          Click a card to dig in — or analyze a new repo below.
        </p>
      </header>

      {/* Inline analyze-input — power-users shouldn't have to bounce
       *  back to the marketing landing to spin up a new analysis. */}
      <WorkspaceInputBar />

      <SessionsList ranked={ranked} />

      {truncated && (
        <div
          className="text-xs text-center"
          style={{ color: TOK.textMuted }}
        >
          Showing the {MAX_SESSIONS_RENDERED} most recent of{" "}
          {allSessions.length} sessions. Older ones still exist on
          disk — use ⌘K to search by name.
        </div>
      )}
    </main>
  );
}

function SessionsList({ ranked }: { ranked: WorkspaceSummary[] }) {
  if (ranked.length === 0) {
    // Sessions exist but we couldn't project any of them — usually a
    // corrupt session JSON. Surface as honest empty state.
    notFound();
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {ranked.map((s) => (
        <WorkspaceCard key={s.id} summary={s} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <main className="px-8 py-16 flex flex-col gap-6 max-w-2xl mx-auto items-center text-center">
      <LayoutGrid size={28} style={{ color: TOK.textMuted }} />
      <h1
        className="text-2xl font-semibold tracking-tight"
        style={{ letterSpacing: "-0.01em" }}
      >
        No sessions yet
      </h1>
      <p className="text-sm" style={{ color: TOK.textSecondary }}>
        The workspace dashboard is for power-users with multiple
        analyzed repos. Analyze one first, then come back.
      </p>
      <Link
        href="/"
        className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
        style={{ color: TOK.accent }}
      >
        Analyze a repo →
      </Link>
    </main>
  );
}
