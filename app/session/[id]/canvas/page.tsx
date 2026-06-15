// /session/[id]/canvas — Canvas tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/sessionTheme";
import { Constellation } from "@/components/views/Constellation";

export const dynamic = "force-dynamic";

export default async function CanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* Compact editorial hero — smaller h1 than text-heavy tabs since
       *  the Constellation canvas below needs vertical room to breathe.
       *  Same eyebrow + h1 + subtitle pattern though, so the page reads
       *  as part of the family. */}
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Canvas
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Hotspot map.
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Each node is a file; size scales with churn, colour with
          author diversity. Drag to rearrange, scroll to zoom, click a
          file to inspect. The min-churn slider focuses the view on
          the most-changed files.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-4">
        <Constellation snapshot={current} />
      </div>
    </main>
  );
}
