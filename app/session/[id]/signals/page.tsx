// /session/[id]/signals — the data behind Health at a Glance (v0.81+).
//
// Health at a Glance aggregates HEALTH_SIGNAL_COUNT deterministic signals into 6 dimension
// tiles, picking ONE "lead" signal per tile based on severity priority.
// That hides most of what fired: the non-lead signals are computed and do
// influence the tile status, but their specific evidence (paths, numbers,
// notes) is invisible. How many depends on the repo, so no count here.
//
// This route exposes every signal individually, grouped into three
// columns matching extractHealthSignals' return shape:
//
//   Working       — positive signals (good test presence, fresh deps,
//                   broad ownership, etc.)
//   Needs Work    — risks/debt with severity badges (untested hotspots,
//                   cross-boundary coupling, vulnerable deps, etc.)
//   Open Questions— observations needing human interpretation
//                   (solo project, metadata dominance, etc.)
//
// Server-rendered (no interactivity needed yet — future iterations could
// add severity filters or signal-id search, but the static view is the
// 80%-case for "I want to see all signals on this session"). Filtering
// belongs on a client component when it lands.

import { notFound } from "next/navigation";
import { getSessionCached } from "@/lib/sessionCache";
import { extractHealthSignals } from "@/lib/signals";
import { TOK } from "@/lib/sessionTheme";
import { SignalsPanel } from "@/components/views/SignalsPanel";

export const dynamic = "force-dynamic";

export default async function SignalsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionCached(id);
  if (!session) notFound();

  const latest = session.snapshots[session.snapshots.length - 1];
  const signals = extractHealthSignals(latest);
  const totalCount =
    signals.working.length +
    signals.needsWork.length +
    signals.questions.length;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Signals · the data behind Health at a Glance
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Every signal, with evidence.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          {totalCount} deterministic signals computed from this snapshot.
          Each card shows the exact rule that produced it, the evidence
          (file paths, numbers), and the severity that drove its dimension
          tile on the overview.
        </p>
      </header>

      <SignalsPanel signals={signals} />
    </main>
  );
}
