// /session/[id] — Overview route (v0.42).
//
// What used to be the entire session page is now just the Overview tab
// content. The tabs themselves live as sibling routes (/canvas, /code,
// /imports, /packages, /prs) and the workspace shell that wraps all of
// them is in layout.tsx.
//
// Backward-compat: ?tab=foo URLs from the v0.37 deep-link era redirect
// to /session/[id]/<foo> via a small client effect at the bottom. The
// v0.37 sub-params (file, fn, container, focus, group) carry through
// unchanged so a Slack-shared link from before the workspace pivot
// still lands on the same view.
//
// v0.44 will reshape this Overview to be more "landing-y" — quick-look
// cards for each tab plus the AI/Health panels in their final spots.
// For now, this just preserves the existing content minus the tab bar.

import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { ExternalLink, FolderTree } from "lucide-react";
import { getSession } from "@/lib/storage";
import { diffSnapshots } from "@/lib/diff";
import { TOK } from "@/lib/theme";
import { StatGrid } from "@/components/views/StatGrid";
import { SinceLastVisit } from "@/components/views/SinceLastVisit";
import { AiSummaryPanel } from "@/components/AiSummaryPanel";
import { HealthPanel } from "@/components/HealthPanel";
import { SessionNameEditor } from "@/components/SessionNameEditor";
import { HotspotTreemap } from "@/components/views/HotspotTreemap";
import { ContributorList } from "@/components/views/ContributorList";
import { LanguageBar } from "@/components/views/LanguageBar";
import { BusFactorPanel } from "@/components/views/BusFactorPanel";
import { CommitActivity } from "@/components/views/CommitActivity";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  // Backward-compat for v0.37 ?tab= deep-links. If a stale link
  // arrives with ?tab=code, redirect to /session/[id]/code so the
  // sub-params (file, fn, focus, etc.) keep working under the new
  // route shape. Only happens once per request, server-side, so the
  // user never sees a flash.
  if (tab && /^(canvas|imports|code|packages|prs)$/.test(tab)) {
    // We don't get the rest of the searchParams here cleanly without
    // also typing them — pass through known v0.37 params explicitly.
    const sp = await searchParams as Record<string, string | undefined>;
    const carry = ["file", "fn", "container", "focus", "group"]
      .map((key) => {
        const v = sp[key];
        return v ? `${key}=${encodeURIComponent(v)}` : null;
      })
      .filter((s): s is string => s !== null)
      .join("&");
    redirect(`/session/${id}/${tab}${carry ? `?${carry}` : ""}`);
  }

  const session = await getSession(id);
  if (!session) notFound();

  const current = session.snapshots[session.snapshots.length - 1];
  const previous =
    session.snapshots.length > 1
      ? session.snapshots[session.snapshots.length - 2]
      : null;
  const diff = previous ? diffSnapshots(previous, current) : null;

  return (
    <main className="max-w-5xl mx-auto px-8 py-10 flex flex-col gap-10">
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

        {/* Demographics: hotspot treemap, contributors, language mix,
         *  bus factor, commit activity. v0.42 lands these on the
         *  Overview landing now that the old "Overview" tab is gone.
         *  v0.44 will reshape this into a more deliberate Overview
         *  layout with quick-look cards. */}
        <section className="grid lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <HotspotTreemap hotspots={current.hotspots} />
            <CommitActivity snap={current} />
          </div>
          <div className="flex flex-col gap-4">
            <ContributorList contributors={current.contributors} />
            <LanguageBar languages={current.languages} />
            <BusFactorPanel hotspots={current.hotspots} />
          </div>
        </section>

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
  );
}
