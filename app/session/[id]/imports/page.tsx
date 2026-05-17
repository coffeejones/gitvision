// /session/[id]/imports — Imports tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { Network } from "lucide-react";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/theme";
import { DependencyCanvas } from "@/components/views/DependencyCanvas";
import { HelpHint } from "@/components/HelpHint";
import { EmptyPanel } from "@/components/EmptyPanel";

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
    <main className="px-8 py-8 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      <div id="screenshot-target" className="flex flex-col gap-4">
        {current.fileGraph && current.fileGraph.nodes.length > 0 ? (
          <DependencyCanvas graph={current.fileGraph} />
        ) : (
          <EmptyPanel
            icon={<Network size={22} />}
            title="No file-to-file imports detected"
            body={
              <>
                GitVision builds the import graph for JS/TS, Python, Go,
                Java, C#, PHP, and Ruby. Tiny repos, single-file projects,
                or snapshots created before the import-graph feature
                shipped will land here.
              </>
            }
            hint={
              <>
                Click <strong>Refresh</strong> in the topbar to regenerate.
              </>
            }
          />
        )}
        <p
          className="text-xs inline-flex items-center gap-1.5"
          style={{ color: TOK.textMuted }}
        >
          File-to-file imports, extends/implements, and framework-specific
          edges (e.g. Spring MVC controller → template). Layered top-down:
          entry points at top, leaves at bottom.
          <HelpHint
            anchor="imports"
            label="File-level dependency canvas, layers, edge kinds"
          />
        </p>
      </div>
    </main>
  );
}
