// /session/[id]/packages — Packages tab as its own route (v0.42).

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { TOK } from "@/lib/sessionTheme";
import { PackagesPanel } from "@/components/views/PackagesPanel";
import { CIHardeningPanel } from "@/components/views/CIHardeningPanel";

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
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Packages
        </span>
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          Dependency health, CVE-aware.
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Vulnerable, outdated, and deprecated packages across every
          manifest CodeTrawl detected. Click any CVE for the full
          advisory, any package name for its registry page.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-6">
        <PackagesPanel snapshot={current} />
        {/* CI-hardening (Arc 4) — the supply chain doesn't stop at manifests;
         *  the workflows that build + publish are attack surface too. Hidden
         *  when the repo has no workflows / pre-dates the check. */}
        {current.ciHardening && (
          <CIHardeningPanel report={current.ciHardening} />
        )}
      </div>
    </main>
  );
}
