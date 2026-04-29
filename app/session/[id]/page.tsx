import { notFound } from "next/navigation";
import { ExternalLink, FolderTree } from "lucide-react";
import { getSession } from "@/lib/storage";
import { diffSnapshots } from "@/lib/diff";
import { TOK } from "@/lib/theme";
import { StatGrid } from "@/components/views/StatGrid";
import { SinceLastVisit } from "@/components/views/SinceLastVisit";
import { SessionToolbar } from "@/components/SessionToolbar";
import { SessionTabs } from "@/components/SessionTabs";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";
import { SessionNameEditor } from "@/components/SessionNameEditor";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const current = session.snapshots[session.snapshots.length - 1];
  const previous =
    session.snapshots.length > 1
      ? session.snapshots[session.snapshots.length - 2]
      : null;
  const diff = previous ? diffSnapshots(previous, current) : null;

  return (
    <>
      <SessionToolbar
        sessionId={session.id}
        sessionName={session.name}
        snapshot={current}
        targetId="screenshot-target"
        updatedAtISO={session.updatedAt}
        snapshotCount={session.snapshots.length}
      />

      <main className="max-w-6xl mx-auto px-8 py-10 flex flex-col gap-10">
        {/* Everything inside #screenshot-target is captured when screenshotting */}
        <div id="screenshot-target" className="flex flex-col gap-10">
          {/* Hero */}
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3 flex-wrap">
              <SessionNameEditor
                sessionId={session.id}
                initialName={session.name}
              />
              <a
                href={session.repoUrl}
                target="_blank"
                rel="noopener"
                className="text-xs font-mono transition hover:underline inline-flex items-center gap-1"
                style={{ color: TOK.textMuted }}
              >
                <span>{current.repo.fullName}</span>
                <ExternalLink size={11} />
              </a>
              {current.analyzedSubdir && (
                <span
                  className="text-xs font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded"
                  style={{
                    background: TOK.accentSoft,
                    color: TOK.accent,
                    border: `1px solid ${TOK.accent}33`,
                  }}
                  title={`Analysis was scoped to this subdirectory. Refresh re-analyzes the same scope. Whole-repo signals (contributors, PRs, language mix) still come from the full repo.`}
                >
                  <FolderTree size={11} />
                  scope: {current.analyzedSubdir}
                </span>
              )}
            </div>

            {current.repo.description && (
              <p
                className="text-base max-w-3xl leading-relaxed"
                style={{ color: TOK.textSecondary }}
              >
                {current.repo.description}
              </p>
            )}

            <div className="pt-1">
              <StatGrid snap={current} />
            </div>

            {current.repo.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {current.repo.topics.slice(0, 12).map((t) => (
                  <span
                    key={t}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: TOK.surface,
                      color: TOK.textMuted,
                      border: `1px solid ${TOK.border}`,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Since last visit */}
          {diff && (
            <SinceLastVisit
              diff={diff}
              repoFullName={current.repo.fullName}
            />
          )}

          {/* AI Summary */}
          <AiSummaryPanel sessionId={session.id} snapshot={current} />

          {/* Health Check */}
          <HealthPanel sessionId={session.id} snapshot={current} />

          {/* Tabs (Canvas / Imports / Code / Packages / PRs / Overview) */}
          <SessionTabs snap={current} />

          {/* Footer */}
          <footer
            className="pt-6 text-xs flex items-center justify-between border-t flex-wrap gap-3"
            style={{ borderColor: TOK.border, color: TOK.textMuted }}
          >
            <span>
              GitVision ·{" "}
              <span className="font-mono">{current.repo.fullName}</span>
            </span>
            <div className="flex items-center gap-3">
              {current.rateLimitInfo && (
                <span>
                  Rate limit:{" "}
                  {current.rateLimitInfo.remaining.toLocaleString()}/
                  {current.rateLimitInfo.limit.toLocaleString()}
                </span>
              )}
              <a href="/legal" className="transition hover:underline">
                Privacy &amp; terms
              </a>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
