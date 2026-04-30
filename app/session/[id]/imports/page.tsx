// /session/[id]/imports — Imports tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/theme";
import { DependencyCanvas } from "@/components/views/DependencyCanvas";

export const dynamic = "force-dynamic";

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 py-8 flex flex-col gap-4">
      <div id="screenshot-target" className="flex flex-col gap-4">
        {current.fileGraph ? (
          <DependencyCanvas graph={current.fileGraph} />
        ) : (
          <div
            className="rounded-xl border border-dashed p-10 text-center text-sm"
            style={{
              borderColor: TOK.border,
              color: TOK.textMuted,
            }}
          >
            This snapshot was created before the dependency graph feature
            landed. Click <strong>Refresh</strong> in the topbar to build
            one.
          </div>
        )}
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          File-to-file imports, extends/implements, and framework-specific
          edges (e.g. Spring MVC controller → template). Layered top-down:
          entry points at top, leaves at bottom.
        </p>
      </div>
    </main>
  );
}
