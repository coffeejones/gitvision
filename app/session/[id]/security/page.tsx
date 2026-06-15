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
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/sessionTheme";
import { SecurityPanel } from "@/components/views/security/SecurityPanel";

export const dynamic = "force-dynamic";

export default async function SecurityRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Security · code + dependencies
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          What deserves a security review.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Three deterministic scanners across your dependencies, your
          source patterns, and your secrets. No AI guesses — every
          finding maps back to a documented advisory, a known
          incident, or a literal pattern match in your code.
        </p>
      </header>

      <SecurityPanel snapshot={current} />
    </main>
  );
}
