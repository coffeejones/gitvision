// /session/[id]/packages — Packages tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { PackagesPanel } from "@/components/views/PackagesPanel";

export const dynamic = "force-dynamic";

export default async function PackagesRoute({
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
        <PackagesPanel snapshot={current} />
      </div>
    </main>
  );
}
