// Workspace dashboard layout (v0.69 / C3 polish).
//
// What returning power-users see when they hit "/" — their analyzed
// repos as a ranked card grid with an inline analyze-input on top.
// Replaces the standalone /workspace route from v0.68; it's now the
// "/" home for anyone who has owned sessions in localStorage.
//
// Rendered by AdaptiveHome. First-time visitors (no owned sessions)
// see MarketingHome instead.

import { LayoutGrid } from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";
import { MarketingNav } from "@/components/MarketingNav";
import { Roadmap } from "@/components/Roadmap";
import { WorkspaceCard } from "@/components/views/WorkspaceCard";
import { WorkspaceInputBar } from "@/components/views/WorkspaceInputBar";
import type { WorkspaceSummary } from "@/lib/intelligence/workspaceTypes";

interface Props {
  /** Already-filtered + ranked summaries — AdaptiveHome handles
   *  ownerId filter and sortWorkspaceByPriority before passing in. */
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
        // so we ramp the marketing-style depth down a notch.
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.06) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.25) 0%, transparent 55%),
          radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "auto, auto, 28px 28px",
        backgroundPosition: "0 0, 0 0, 0 0",
        backgroundAttachment: "fixed, fixed, fixed",
      }}
    >
      <MarketingNav />
      <main className="max-w-6xl w-full mx-auto px-6 sm:px-10 lg:px-16 pt-12 pb-20 flex flex-col gap-16">
        {/* Header — Logo lives in MarketingNav now; header opens
         *  straight on the dashboard eyebrow + title. */}
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} style={{ color: TOK.accent }} />
            <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
              Workspace · {summaries.length} session
              {summaries.length === 1 ? "" : "s"}, ranked by attention
            </span>
          </div>
          <h1
            className="text-3xl sm:text-4xl font-semibold tracking-tight"
            style={{ letterSpacing: "-0.02em" }}
          >
            Your code dashboard
          </h1>
          <p
            className="text-sm sm:text-base max-w-2xl leading-relaxed"
            style={{ color: TOK.textMuted }}
          >
            One card per analyzed repo, ordered most-critical first.
            Click a card to dig in — or analyze a new repo below.
          </p>
        </header>

        {/* Inline analyze-input — power-users shouldn't have to bounce
         *  back to a marketing landing to spin up a new analysis.
         *  Inherits the lifted-card contrast from RepoInputForm. */}
        <WorkspaceInputBar />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {summaries.map((s) => (
            <WorkspaceCard key={s.id} summary={s} />
          ))}
        </div>

        {/* Sessions footer-hint: the keyboard shortcut tip is always
         *  useful (discoverability), but the "Showing N of M" prefix
         *  only makes sense when there's real truncation. So split:
         *  truncation prefix is conditional, kbd hint is permanent. */}
        <div
          className="text-xs text-center -mt-8"
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
