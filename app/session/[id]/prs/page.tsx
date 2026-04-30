// /session/[id]/prs — PRs tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { PRFlow } from "@/components/views/PRFlow";

export const dynamic = "force-dynamic";

export default async function PRsRoute({
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
        <PRFlow prs={current.pullRequests ?? []} />
      </div>
    </main>
  );
}
