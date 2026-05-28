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
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Imports
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          File-to-file dependency graph.
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed inline-flex items-baseline gap-1.5"
          style={{ color: TOK.textSecondary }}
        >
          <span>
            Imports, extends/implements, and framework edges (e.g. Spring
            MVC controller → template). Layered top-down — entry points
            at top, leaves at bottom.
          </span>
          <HelpHint
            anchor="imports"
            label="File-level dependency canvas, layers, edge kinds"
          />
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-4">
        {current.fileGraph && current.fileGraph.nodes.length > 0 ? (
          <DependencyCanvas graph={current.fileGraph} />
        ) : (
          <EmptyPanel
            icon={<Network size={22} />}
            title="No file-to-file imports detected"
            body={
              <>
                RepoJury builds the import graph for JS/TS, Python, Go,
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
      </div>
    </main>
  );
}
