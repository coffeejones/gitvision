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
    <main className="px-8 py-8 flex flex-col gap-4">
      <div id="screenshot-target" className="flex flex-col gap-4">
        <CodePanel snapshot={current} />
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Pick a file (or click one in the heaviest-files / top-complex
          lists) to see its blast radius. Incoming = files that break if
          you change this. Outgoing = what this depends on. Hops capped
          at 3 to keep central files from showing &quot;everything&quot;.
        </p>
      </div>
    </main>
  );
}
