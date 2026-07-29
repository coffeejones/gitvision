// /session/[id]/security — dedicated Security tab (v0.81+).
//
// Co-locates the three security scanners — supply-chain incidents,
// secret leakage, dynamic-execution patterns — in one focused view.
// They each appear elsewhere too (Signals tab + dimension tiles),
// but this route is the deep-dive: per-incident cards with advisory
// links, per-finding source snippets, scan-scope guidance even when
// clean. Brand promise of "deterministic, here's the audit trail"
// rendered as a single page.
//
// Server-rendered. No interactivity yet — the data is pure-output
// from analyzeRepo. Future iterations could add per-section filters
// or "mark as reviewed" UX; for now the scanned-vs-clean status is
// the actionable cut.

import { notFound } from "next/navigation";
import { getSessionCached } from "@/lib/sessionCache";
import { SecurityPanel } from "@/components/views/security/SecurityPanel";
import { OrientationStrip } from "@/components/views/OrientationStrip";

export const dynamic = "force-dynamic";

export default async function SecurityRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionCached(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Security · code + dependencies"
        title="What deserves a security review."
        line="Four deterministic scanners — incidents, secrets, code paths, risky eval/exec. Every finding maps to an advisory, a known incident, or a literal match. Code-path findings also say whether anything can actually reach them: a traced path means reachable from an entry point, not that the call happens on every request."
      />

      <SecurityPanel snapshot={current} sessionId={id} />
    </main>
  );
}
