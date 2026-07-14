// /session/[id]/source — the read-only Source view.
//
// GitHub's blob view, but every file carries CodeTrawl's deterministic findings.
// Source is fetched live per file (see /api/sessions/[id]/source) and never
// stored. Free in the free-phase; a signed-in account gates the GitHub token
// budget, and demo sessions bypass so the public showcase needs no login.

import { notFound } from "next/navigation";
import { FileCode } from "lucide-react";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { isDemoSession } from "@/lib/demoSessions";
import { TOK } from "@/lib/sessionTheme";
import { SourcePanel } from "@/components/views/SourcePanel";
import { SignInToUnlock } from "@/components/billing/SignInToUnlock";
import { EmptyPanel } from "@/components/EmptyPanel";
import { computeFileChips } from "@/lib/sourceAnnotations";

export const dynamic = "force-dynamic";

export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  const entitled = isDemo || !!authSession;

  const files = Object.keys(current.codeGraph?.contentHashes ?? {}).sort();

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Source
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.02em", lineHeight: 1.1 }}
        >
          Read the code, with the evidence on it.
        </h1>
        <p className="text-sm max-w-2xl leading-relaxed" style={{ color: TOK.textSecondary }}>
          Every file we analyzed, read-only and syntax-highlighted — fetched live
          from GitHub at the exact commit we swept, and never stored. The
          deterministic findings ride along on the code itself.
        </p>
      </header>

      {!entitled ? (
        <SignInToUnlock
          featureName="the Source view"
          redirectTo={`/session/${id}/source`}
          context="Read any analyzed file with CodeTrawl's findings on every line — free with any account."
        />
      ) : files.length === 0 ? (
        <EmptyPanel
          icon={<FileCode size={22} />}
          title="No analyzed files to show yet"
          body={
            <>
              The Source view lists the files CodeTrawl parsed. Tiny repos, or
              snapshots created before code analysis shipped, land here.
            </>
          }
          hint={
            <>
              Click <strong>Refresh</strong> in the topbar to re-analyze and
              populate it.
            </>
          }
        />
      ) : (
        <SourcePanel sessionId={session.id} files={files} chips={computeFileChips(current)} />
      )}
    </main>
  );
}
