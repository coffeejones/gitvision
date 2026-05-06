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
       *  back to a marketing landing to spin up a new analysis. */}
      <WorkspaceInputBar />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {summaries.map((s) => (
          <WorkspaceCard key={s.id} summary={s} />
        ))}
      </div>

      {totalOnDisk > summaries.length && (
        <div
          className="text-xs text-center"
          style={{ color: TOK.textMuted }}
        >
          Showing the {summaries.length} most recent of {totalOnDisk}{" "}
          sessions. Older ones still exist on disk — use ⌘K to search
          by name.
        </div>
      )}
    </main>
  );
}
