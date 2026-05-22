// /session/[id]/code — Code tab as its own route (v0.42).
//
// The route ALSO honors the v0.37 deep-link sub-params (?file, ?fn,
// ?container, ?focus, ?group). CodePanel reads them itself via
// useSearchParams; we don't need to thread them through here.

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/theme";
import { CodePanel } from "@/components/views/CodePanel";

export const dynamic = "force-dynamic";

export default async function CodeRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Code
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Blast radius, hotspots, duplicates.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Pick a file from the heaviest-files or top-complex lists to
          see what breaks if you change it. Incoming = files that
          depend on this. Outgoing = what this depends on. Hops capped
          at 3 so central files don&apos;t show &quot;everything&quot;.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-4">
        <CodePanel snapshot={current} />
      </div>
    </main>
  );
}
