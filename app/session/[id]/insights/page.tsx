// /session/[id]/insights — AI Summary + Health Check (v0.44).
//
// Both AI panels used to render on the Overview landing as always-on
// content. That worked when the page was a long dashboard scroll, but
// in workspace mode it bloated the Overview and made it less of a
// landing. Moved here so the user reaches for AI insights when they
// want them.
//
// The two panels stack vertically with a clear hierarchy:
//   1. AI Summary — what the repo is, in 150-200 words.
//   2. Health Check — the three-column verdict grounded in 17 signals.
//
// If ANTHROPIC_API_KEY isn't set, both panels render their own empty
// state explaining that AI features are off.

import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getSession } from "@/lib/storage";
import { STYLE, TOK } from "@/lib/theme";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";

export const dynamic = "force-dynamic";

export default async function InsightsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 py-8 flex flex-col gap-6">
      <div id="screenshot-target" className="flex flex-col gap-6 max-w-4xl">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: TOK.accent }} />
            <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
              Insights
            </span>
          </div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            AI summary &amp; health verdict
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Generated from the latest snapshot. Every claim is grounded in
            a deterministic signal computed server-side — see the Health
            section&apos;s &quot;evidence&quot; tags for the underlying
            data.
          </p>
        </header>

        <AiSummaryPanel sessionId={session.id} snapshot={current} />
        <HealthPanel sessionId={session.id} snapshot={current} />
      </div>
    </main>
  );
}
