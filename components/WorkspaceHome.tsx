// Workspace dashboard layout (v0.69 / C3 polish).
//
// What returning power-users see when they hit "/" — their analyzed
// repos as a ranked card grid with an inline analyze-input on top.
// Replaces the standalone /workspace route from v0.68; it's now the
// "/" home for anyone who has owned sessions in localStorage.
//
// Rendered by AdaptiveHome. First-time visitors (no owned sessions)
// see MarketingHome instead.

import { TOK } from "@/lib/theme";
import { MarketingNav } from "@/components/MarketingNav";
import { Roadmap } from "@/components/Roadmap";
import { WorkspaceCard } from "@/components/views/WorkspaceCard";
import { WorkspaceInputBar } from "@/components/views/WorkspaceInputBar";
import type { WorkspaceSummary } from "@/lib/intelligence/workspaceTypes";

interface Props {
  /** Already-filtered + ranked summaries — AdaptiveHome handles
   *  user-id filter and sortWorkspaceByPriority before passing in. */
  summaries: WorkspaceSummary[];
  /** Total session count on disk (vs. summaries.length which is
   *  capped). Drives the "showing N of M" hint when truncated. */
  totalOnDisk: number;
}

export function WorkspaceHome({ summaries, totalOnDisk }: Props) {
  return (
    <div
      className="min-h-screen w-full"
      style={{
        // Same diagonal monochrome ambient as MarketingHome but with
        // softened intensity — power-users see this page repeatedly,
        // so we ramp the marketing-style depth down a notch. Dot-grid
        // was dropped in v0.76 (same time MarketingHome lost it) so
        // logged-in and logged-out surfaces stay visually consistent.
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.06) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.25) 0%, transparent 55%)
        `,
        backgroundAttachment: "fixed, fixed",
      }}
    >
      <MarketingNav />
      <main className="max-w-7xl w-full mx-auto px-6 sm:px-10 lg:px-12 pt-16 pb-24 flex flex-col gap-20">
        {/* Header — editorial-tone hero. Eyebrow is one word ("Workspace")
         *  not a data tabular phrase. The h1 carries the actual story
         *  ("ranked by attention"), the subtitle gives the single
         *  actionable thing to do. Apple-style hero: one clear message,
         *  generous gap, no chrome icons competing with text. */}
        <header className="flex flex-col gap-5">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Workspace
          </span>
          <h1
            className="text-4xl sm:text-5xl font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            Your code, ranked by attention.
          </h1>
          <p
            className="text-base sm:text-lg max-w-2xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            {summaries.length} {summaries.length === 1 ? "repo" : "repos"}{" "}
            analyzed. Open any card for the full breakdown, or queue a
            new repo below.
          </p>
        </header>

        {/* Inline analyze-input — power-users shouldn't have to bounce
         *  back to a marketing landing to spin up a new analysis.
         *  Inherits the lifted-card contrast from RepoInputForm. */}
        <WorkspaceInputBar />

        {/* Repo cards — gap-5 instead of gap-3 so the grid breathes.
         *  WorkspaceCard handles its own hover-lift + material depth. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {summaries.map((s) => (
            <WorkspaceCard key={s.id} summary={s} />
          ))}
        </div>

        {/* Sessions footer-hint: the keyboard shortcut tip is always
         *  useful (discoverability), but the "Showing N of M" prefix
         *  only makes sense when there's real truncation. So split:
         *  truncation prefix is conditional, kbd hint is permanent.
         *
         *  Lives as its own gap-20 section now, not glued under the
         *  card grid with a hacky negative margin. */}
        <div
          className="text-xs text-center"
          style={{ color: TOK.textMuted }}
        >
          {totalOnDisk > summaries.length && (
            <>
              Showing the {summaries.length} most recent of {totalOnDisk}{" "}
              sessions. Older ones still exist on disk — press{" "}
            </>
          )}
          {totalOnDisk <= summaries.length && <>Press </>}
          <kbd
            className="font-mono px-1.5 py-0.5 rounded text-[10px] mx-0.5"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textSecondary,
            }}
          >
            ⌘K
          </kbd>
          <span> or </span>
          <kbd
            className="font-mono px-1.5 py-0.5 rounded text-[10px] mx-0.5"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textSecondary,
            }}
          >
            Ctrl+K
          </kbd>{" "}
          to search your sessions by name.
        </div>

        {/* Roadmap — same component as MarketingHome. Returning
         *  power-users get the "what changed since I was last here"
         *  view at the bottom of their dashboard, where it doesn't
         *  push the actually-actionable cards below the fold. */}
        <Roadmap />
      </main>
    </div>
  );
}
