// /session/[id]/canvas — Canvas tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/theme";
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
    <main className="px-8 py-8 flex flex-col gap-4">
      <div id="screenshot-target" className="flex flex-col gap-4">
        <Constellation snapshot={current} />
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Tip: drag nodes to rearrange · scroll to zoom · click a file to
          inspect · use the min-churn slider to focus on the most-changed
          files.
        </p>
      </div>
    </main>
  );
}
