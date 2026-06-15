import type { AnalysisSnapshot } from "@/lib/types";
import { TOK } from "@/lib/sessionTheme";

// Cap to the last MAX_WEEKS so big repos like golang/go (multi-year
// history → 200+ weeks) don't blow out the bar chart.
//
// At 52 weeks with min-w-[4px] bars + gap-0.5 (2px) between, the chart
// is ~310px wide — fits comfortably in the left column on every layout.
// Beyond 52 weeks the bars compress below 4px (capped by min-width)
// and end up overflowing the container horizontally, which on the
// workspace Overview page leaked into the right-column Top Contributors
// + Language Mix panels.
//
// We show "last year of activity" rather than "everything since epoch"
// because (a) recent activity is what tells the current story, and
// (b) the visual density at 52 bars is the right balance between
// "scannable trend" and "data density."
const MAX_WEEKS = 52;

export function CommitActivity({ snap }: { snap: AnalysisSnapshot }) {
  const all = snap.commitActivity;
  if (all.length === 0) {
    return null;
  }
  const data = all.slice(-MAX_WEEKS);
  const max = Math.max(...data.map((d) => d.count));
  const truncated = all.length > data.length;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h3
        className="text-base font-semibold tracking-tight mb-3 flex items-baseline gap-2 flex-wrap"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.01em",
        }}
      >
        Weekly commit activity
        <span
          className="text-[10px] normal-case tracking-normal font-normal"
          style={{ color: TOK.textMuted }}
        >
          ·{" "}
          {truncated
            ? `last ${data.length} weeks of sampled commits`
            : "from sampled commits"}
        </span>
      </h3>
      {/* overflow-hidden as a belt-and-braces against future data
       *  shapes that exceed MAX_WEEKS — bars stay clipped to the card
       *  even if the cap changes. */}
      <div className="flex items-end gap-0.5 h-24 overflow-hidden">
        {data.map((d) => (
          <div
            key={d.week}
            title={`${d.week}: ${d.count} commits`}
            className="flex-1 min-w-[4px] rounded-sm transition-colors"
            style={{
              height: `${Math.max(2, (d.count / max) * 100)}%`,
              background:
                d.count === 0
                  ? "rgba(255,255,255,0.04)"
                  : TOK.accent,
              opacity: d.count === 0 ? 1 : 0.75,
            }}
          />
        ))}
      </div>
      <div
        className="mt-2 flex justify-between text-[10px] font-mono"
        style={{ color: TOK.textMuted }}
      >
        <span>{data[0].week}</span>
        <span>{data[data.length - 1].week}</span>
      </div>
    </div>
  );
}
