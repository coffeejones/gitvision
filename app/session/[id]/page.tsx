// /session/[id] — Overview route (v0.42, reshaped in v0.44, v0.57-v0.67).
//
// In workspace mode this is the landing page for a session — the
// "what is this repo, and where do I go to dig in" view.
//
// Layout, top to bottom:
//   1. Hero — name (editable), repo URL, scope, description, StatGrid,
//      topics chips.
//   2. Refresh banner ("Since your last visit") — only when there's a
//      diff. Story-driven headline + supporting chips.
//   3. Structural diff panel (v0.67) — per-function / per-file diff
//      between snapshots. Sits between aggregate (SinceLastVisit) and
//      single-best (Headline) so the page reads at three zoom levels.
//   4. Headline finding (v0.57) — one concrete actionable signal picked
//      by lib/intelligence/headline.ts. The 30-second rule from
//      r/devtools alpha feedback: visitors need to see impact fast.
//   5. Health-at-a-glance strip (v0.59) — six traffic-light tiles,
//      one per dimension. Promotes the deterministic signal layer
//      out of the Insights tab into the landing view.
//   6. Quick-look cards — one card per workspace tab, each showing a
//      stat preview and linking to the dedicated route. This is the
//      "navigation that tells a story" surface.
//   7. Touch-with-care panel (v0.58) — top blast-radius functions,
//      promoted out of the Code tab. Click a row to drill into the full
//      blast view. Only renders when there are ranked functions.
//   8. Demographics — hotspot treemap, contributors, language mix,
//      bus factor, weekly commit activity. The "high-level read" of
//      the repo.
//   9. Footer.
//
// What's NOT here anymore (compared to pre-v0.44):
//   - AI Summary and Health Check moved to /session/[id]/insights so
//     the Overview reads as a workspace landing rather than a long
//     scroll of AI walls of text.
//
// Backward-compat: ?tab= deep-links from v0.37 are still honored
// (server-redirect to the matching route) so older shared URLs keep
// working.

import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Boxes,
  Code as CodeIcon,
  ExternalLink,
  FileCode,
  FolderTree,
  GitPullRequest,
  Network,
  Package,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/storage";
import { diffSnapshots } from "@/lib/diff";
import { findDuplicateGroups } from "@/lib/codeAnalysis/duplicates";
import { computeTestCoverage } from "@/lib/codeAnalysis/testCoverage";
import { rankFunctionsByBlast } from "@/lib/codeAnalysis/blastRanking";
import { pickHeadline } from "@/lib/intelligence/headline";
import {
  computeHealthTrend,
  diffHealthSummaries,
  summarizeHealth,
} from "@/lib/intelligence/healthSummary";
import {
  structuralDiff,
  structuralDiffHasContent,
} from "@/lib/intelligence/structuralDiff";
import { STYLE, TOK } from "@/lib/theme";
import { StatGrid } from "@/components/views/StatGrid";
import { SinceLastVisit } from "@/components/views/SinceLastVisit";
import { HeadlineFinding } from "@/components/HeadlineFinding";
import { BlastRadiusPanel } from "@/components/views/BlastRadiusPanel";
import { HealthSummary } from "@/components/views/HealthSummary";
import { SecretFindingsPanel } from "@/components/views/SecretFindingsPanel";
import { StructuralDiffPanel } from "@/components/views/StructuralDiffPanel";
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
  const sp = await searchParams as Record<string, string | undefined>;

  // v0.37 ?tab= back-compat. Stale shared URLs redirect to their new
  // route + carry forward the v0.37 deep-link sub-params.
  if (sp.tab && /^(canvas|imports|code|packages|prs|insights)$/.test(sp.tab)) {
    const carry = ["file", "fn", "container", "focus", "group"]
      .map((key) => {
        const v = sp[key];
        return v ? `${key}=${encodeURIComponent(v)}` : null;
      })
      .filter((s): s is string => s !== null)
      .join("&");
    redirect(`/session/${id}/${sp.tab}${carry ? `?${carry}` : ""}`);
  }

  const session = await getSession(id);
  if (!session) notFound();

  const current = session.snapshots[session.snapshots.length - 1];
  const previous =
    session.snapshots.length > 1
      ? session.snapshots[session.snapshots.length - 2]
      : null;
  const diff = previous ? diffSnapshots(previous, current) : null;

  // Derive the per-tab preview stats. Server-side compute is fine
  // for these — they're pure functions over the snapshot.
  const codeGraph = current.codeGraph;
  const duplicateGroups = codeGraph ? findDuplicateGroups(codeGraph) : [];
  const coverage = codeGraph
    ? computeTestCoverage(codeGraph)
    : null;
  const fileGraph = current.fileGraph;
  const hotspotCount = current.hotspots?.length ?? 0;
  const prCount = current.pullRequests?.length ?? 0;
  // Top language by bytes — `languages` is { [name: string]: bytes }.
  const topLanguage =
    Object.entries(current.languages ?? {})
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
  const healths =
    current.dependencyHealths ??
    (current.dependencyHealth ? [current.dependencyHealth] : []);
  const packageCount = healths.reduce(
    (s, h) => s + (h.uniquePackages ?? h.total),
    0
  );
  const packageIssues = healths.reduce(
    (s, h) => s + h.vulnerable.length + h.deprecated.length,
    0
  );

  // v0.57: pick the single most-actionable signal for above-the-fold.
  // Pure function — server-rendered, no AI call.
  const headline = pickHeadline(current);

  // v0.58: rank functions by transitive blast radius for the
  // "Touch with care" panel. Pure server compute, default top 5.
  // Empty array when there are no resolved calls (regex-fallback-only
  // langs, tiny repos) — the panel hides itself in that case.
  const blastRanking = codeGraph ? rankFunctionsByBlast(codeGraph) : [];

  // v0.59: traffic-light health summary. Pure mapping over the existing
  // signal layer — no new compute. Six dimensions, one tile each.
  const healthSummaries = summarizeHealth(current);

  // v0.62: per-dimension diff vs. previous snapshot. Drives the
  // tiny TrendingUp/Down indicators on each tile so refresh-visitors
  // see "Code went from healthy → critical since last visit" at a
  // glance. Skipped on first-snapshot sessions.
  const healthDeltas = previous
    ? diffHealthSummaries(previous, current)
    : undefined;

  // v0.68: trend across last N snapshots for inline sparklines on
  // each HealthSummary tile. Only computed when the session has
  // 3+ snapshots — under that, the delta arrows already cover the
  // current-vs-previous case more clearly.
  const healthTrend =
    session.snapshots.length >= 3
      ? computeHealthTrend(session.snapshots)
      : undefined;

  // v0.67: per-function / per-file structural diff. Computed only
  // when there's a previous snapshot AND there's actual content to
  // show — small refreshes that touched no code don't need a panel.
  const structDiff = previous ? structuralDiff(previous, current) : null;
  const showStructuralDiff =
    structDiff !== null && structuralDiffHasContent(structDiff);

  const base = `/session/${session.id}`;

  return (
    <main className="px-8 py-10 flex flex-col gap-10 max-w-7xl mx-auto w-full">
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

        {/* Since last visit — only when there's a diff */}
        {diff && (
          <SinceLastVisit
            diff={diff}
            repoFullName={current.repo.fullName}
          />
        )}

        {/* Structural changes (v0.67 / C2) — per-function / per-file
         *  diff between snapshots. Lives between SinceLastVisit
         *  (aggregate) and Headline finding (single-best signal) so
         *  the page reads at three zoom levels: high-level deltas →
         *  detailed deltas → top finding to act on. Hides itself
         *  when there's no previous snapshot or no actual change. */}
        {showStructuralDiff && structDiff && (
          <StructuralDiffPanel diff={structDiff} />
        )}

        {/* Headline finding (v0.57) — the 30-second-rule signal. One
         *  concrete actionable thing per session, picked by the waterfall
         *  in lib/intelligence/headline.ts. */}
        <HeadlineFinding headline={headline} sessionId={session.id} />

        {/* Health at a glance (v0.59 + v0.62 deltas + v0.68 trend) —
         *  six traffic-light tiles. Optional delta arrows when there's
         *  a previous snapshot. Optional inline sparkline when session
         *  has 3+ snapshots (power-user direction-of-travel signal). */}
        <HealthSummary
          summaries={healthSummaries}
          sessionId={session.id}
          deltas={healthDeltas}
          trend={healthTrend}
        />

        {/* Possible secrets (v0.61) — regex-pass findings. Hides itself
         *  when the snapshot has no findings (cleanest case) or no
         *  scan ran (pre-v0.61 sessions). The headline-finding above
         *  already shouts about critical leaks; this is the drilldown. */}
        {current.secretFindings && (
          <SecretFindingsPanel result={current.secretFindings} />
        )}

        {/* Quick-look cards: navigation that tells a story. Each card
         *  shows the headline stat for its tab so users can scan
         *  "where the interesting work is" before clicking in. */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span
              className={STYLE.eyebrow}
              style={{ color: TOK.textMuted }}
            >
              Workspace
            </span>
            <span className="text-xs" style={{ color: TOK.textMuted }}>
              · click any card to dive in
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLookCard
              href={`${base}/canvas`}
              icon={<Network size={15} />}
              label="Canvas"
              stat={
                hotspotCount > 0
                  ? `${hotspotCount.toLocaleString()} hotspots${topLanguage ? ` · ${topLanguage}` : ""}`
                  : "No hotspot data"
              }
              description="Folder map · color by author or type · time-scrub history"
            />
            <QuickLookCard
              href={`${base}/imports`}
              icon={<FileCode size={15} />}
              label="Imports"
              stat={
                fileGraph
                  ? `${fileGraph.nodes.length.toLocaleString()} files · ${fileGraph.edges.length.toLocaleString()} edges`
                  : "Refresh to populate"
              }
              description="File-to-file imports + extends/implements + framework edges"
            />
            <QuickLookCard
              href={`${base}/code`}
              icon={<CodeIcon size={15} />}
              label="Code"
              stat={
                codeGraph
                  ? formatCodeStat(
                      codeGraph.functions.length,
                      duplicateGroups.length,
                      coverage
                    )
                  : "Refresh to populate"
              }
              description="Blast radius · untested hotspots · structural duplicates"
              accent={duplicateGroups.length > 0 || !!(coverage && coverage.totals.testFiles > 0)}
            />
            <QuickLookCard
              href={`${base}/architecture`}
              icon={<Boxes size={15} />}
              label="Architecture"
              stat={
                codeGraph?.classes && codeGraph.classes.length > 0
                  ? `${codeGraph.classes.length.toLocaleString()} class${
                      codeGraph.classes.length === 1 ? "" : "es"
                    } extracted`
                  : codeGraph
                    ? "No classes detected"
                    : "Refresh to populate"
              }
              description="Class diagrams · Mermaid export · architectural intelligence"
            />
            <QuickLookCard
              href={`${base}/packages`}
              icon={<Package size={15} />}
              label="Packages"
              stat={
                packageCount > 0
                  ? `${packageCount.toLocaleString()} packages${
                      packageIssues > 0 ? ` · ${packageIssues} issue${packageIssues === 1 ? "" : "s"}` : ""
                    }`
                  : "No manifests detected"
              }
              description="CVE-aware health for npm / Cargo / PyPI"
              warn={packageIssues > 0}
            />
            <QuickLookCard
              href={`${base}/prs`}
              icon={<GitPullRequest size={15} />}
              label="PRs"
              stat={
                prCount > 0
                  ? `${prCount.toLocaleString()} pull requests`
                  : "No PR data"
              }
              description="Sankey of cycle-time flow · median time-to-merge"
            />
            <QuickLookCard
              href={`${base}/insights`}
              icon={<Sparkles size={15} />}
              label="Insights"
              stat="AI summary + health verdict"
              description="Grounded in 17 deterministic signals · zero hallucination"
            />
          </div>
        </section>

        {/* Touch-with-care (v0.58) — promotes blast radius out of the
         *  Code tab. Hides itself when ranking is empty (small repos,
         *  regex-fallback-only langs). */}
        <BlastRadiusPanel ranked={blastRanking} sessionId={session.id} />

        {/* Demographics — high-level read of the repo. Stays on
         *  Overview because these are at-a-glance stats that pair
         *  with the hero, not deep tools that deserve their own tab. */}
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

function formatCodeStat(
  fnCount: number,
  duplicateCount: number,
  coverage: { totals: { prodFunctions: number; testedProdFunctions: number; testFiles: number } } | null
): string {
  const parts: string[] = [`${fnCount.toLocaleString()} fns`];
  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} duplicate group${duplicateCount === 1 ? "" : "s"}`);
  }
  if (coverage && coverage.totals.testFiles > 0 && coverage.totals.prodFunctions > 0) {
    const pct = Math.round(
      (coverage.totals.testedProdFunctions / coverage.totals.prodFunctions) * 100
    );
    parts.push(`${pct}% covered`);
  }
  return parts.join(" · ");
}

interface QuickLookCardProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  stat: string;
  description: string;
  /** Subtle accent border when there's something interesting on this
   *  tab (e.g. duplicate groups, untested hotspots). Draws the eye. */
  accent?: boolean;
  /** Rose accent border when there's a problem (e.g. CVEs). Stronger
   *  visual pull than the green accent. */
  warn?: boolean;
}

function QuickLookCard({
  href,
  icon,
  label,
  stat,
  description,
  accent,
  warn,
}: QuickLookCardProps) {
  const borderColor = warn ? `${TOK.rose}33` : accent ? `${TOK.accent}33` : TOK.border;
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 p-4 rounded-xl transition"
      style={{
        background: TOK.surface,
        border: `1px solid ${borderColor}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            color: warn ? TOK.rose : accent ? TOK.accent : TOK.textSecondary,
          }}
        >
          {icon}
        </span>
        <span
          className="text-sm font-medium"
          style={{ color: TOK.textPrimary }}
        >
          {label}
        </span>
        <ArrowRight
          size={13}
          className="ml-auto opacity-40 group-hover:opacity-100 transition"
          style={{ color: TOK.textSecondary }}
        />
      </div>
      <div
        className="text-xs font-mono tabular-nums"
        style={{ color: TOK.textPrimary }}
      >
        {stat}
      </div>
      <div className="text-[11px]" style={{ color: TOK.textMuted }}>
        {description}
      </div>
    </Link>
  );
}
