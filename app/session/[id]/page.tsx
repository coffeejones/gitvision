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
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
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
import { headers } from "next/headers";
import { getSessionCached, getDriftReport } from "@/lib/sessionCache";
import { markSeen } from "@/lib/seen";
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
import type { DimensionStatus } from "@/lib/intelligence/healthSummary";
import {
  structuralDiff,
  structuralDiffHasContent,
} from "@/lib/intelligence/structuralDiff";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { StatGrid } from "@/components/views/StatGrid";
import { SinceLastVisit } from "@/components/views/SinceLastVisit";
import { HeadlineFinding } from "@/components/HeadlineFinding";
import { BlastRadiusPanel } from "@/components/views/BlastRadiusPanel";
import { HealthSummary } from "@/components/views/HealthSummary";
import { SecretFindingsPanel } from "@/components/views/SecretFindingsPanel";
import { StructuralDiffPanel } from "@/components/views/StructuralDiffPanel";
import { DriftPanel } from "@/components/views/DriftPanel";
import { SessionNameEditor } from "@/components/SessionNameEditor";
import { HotspotTreemap } from "@/components/views/HotspotTreemap";
import { ContributorList } from "@/components/views/ContributorList";
import { LanguageBar } from "@/components/views/LanguageBar";
import { BusFactorPanel } from "@/components/views/BusFactorPanel";
import { CommitActivity } from "@/components/views/CommitActivity";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { RollupBar } from "@/components/views/RollupBar";
import { AnchorGlow } from "@/components/views/AnchorGlow";

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

  const session = await getSessionCached(id);
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
  // Count runtime-scope issues only, matching the Security/Supply verdict
  // (dev/test/docs deps don't drive the ruling) — so the Overview's package
  // numbers reconcile with the verdict cards instead of reading higher.
  const isRuntimeDep = (d: { scope?: string }) => d.scope !== "dev";
  const packageVulnerable = healths.reduce(
    (s, h) => s + h.vulnerable.filter(isRuntimeDep).length,
    0
  );
  const packageOutdated = healths.reduce(
    (s, h) =>
      s + h.outdated.filter((d) => isRuntimeDep(d) && d.ageMonths >= 12).length,
    0
  );
  const packageIssues = packageVulnerable + packageOutdated;

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

  // Phase 2 (Move E): a posture rollup — the SAME six-dimension array the
  // HealthSummary strip renders, folded to one status tally above the fold. A
  // pure reduce, zero new analysis. Deliberately a tally (all five statuses
  // stay visible), never a grade: it shows the split, it doesn't score it.
  // Colors mirror HealthSummary's STATUS_STYLES so the bar and the tiles agree.
  const ROLLUP_TIERS: {
    status: DimensionStatus;
    color: string;
    label: string;
  }[] = [
    { status: "critical", color: TOK.rose, label: "critical" },
    { status: "warning", color: TOK.amber, label: "need work" },
    { status: "healthy", color: TOK.accent, label: "healthy" },
    { status: "solo", color: TOK.textSecondary, label: "solo" },
    { status: "unknown", color: TOK.textMuted, label: "not measured" },
  ];
  const healthRollup = ROLLUP_TIERS.map((t) => ({
    count: healthSummaries.filter((s) => s.status === t.status).length,
    color: t.color,
    label: t.label,
  }));
  // Skip the rollup when there's genuinely nothing measured (matches the
  // HealthSummary strip, which hides itself in the all-unknown case).
  const showHealthRollup = healthSummaries.some((s) => s.status !== "unknown");

  // The orientation lead. On a refresh the "since last visit" banner renders
  // before the top finding, so the "start here" beat has to be honest about
  // what's actually first — condition it on whether there's a diff.
  const overviewLine = diff
    ? "What changed since your last visit, the top finding, then six rule-based health tiles. Start at the top, then open any card."
    : "The top finding, then six rule-based health tiles. Start with the finding, then open any card.";

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
  // v0.78: gated to Plus+ — Free sees the SinceLastVisit aggregate
  // diff but not the per-function semantic deltas.
  // Public demo sessions bypass the gate so logged-out visitors see the
  // per-function semantic diff too.
  const authSession = await getAuthSession();
  const hasStructuralDiff =
    isDemoSession(id) ||
    (authSession
      ? await canAccess(authSession.user.id, "structuralDiff")
      : false);
  const structDiff = previous ? structuralDiff(previous, current) : null;
  const showStructuralDiff =
    hasStructuralDiff &&
    structDiff !== null &&
    structuralDiffHasContent(structDiff);

  // Arc 3: multi-sweep drift trends. Diffs the earliest measurable snapshot
  // against the latest (full-span "direction of travel"), so it complements
  // the current-vs-previous StructuralDiff rather than duplicating it. Falls
  // back to computing fingerprints on the fly, so it works retroactively for
  // pre-fingerprint snapshots. Same Plus gate + demo bypass as the structural
  // diff — both are snapshot-diff surfaces. Hidden on single-snapshot sessions
  // and when nothing drifted beyond the noise floor.
  const driftReport = await getDriftReport(id);
  const showDrift =
    hasStructuralDiff && driftReport.hasBaseline && driftReport.trends.length > 0;

  // Advance the viewer's Chambers "seen" baseline: opening this detail
  // page means they've now seen the latest verdict, so the case stops
  // showing a since-last-visit delta until something new lands. Skipped
  // on prefetch (hovering a case row in the list mustn't pre-clear its
  // delta) and for anonymous viewers. Best-effort — never blocks render.
  const isPrefetch = (await headers()).get("next-router-prefetch") === "1";
  if (authSession && !isPrefetch) {
    await markSeen(authSession.user.id, session.id, current.fetchedAt);
  }

  const base = `/session/${session.id}`;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full">
      <div id="screenshot-target" className="flex flex-col gap-10">
        {/* Hero — editorial framing matching the other sub-page heros
         *  (Code / Packages / Insights). Eyebrow holds the session/repo
         *  identity, h1 is the editable session name, supporting meta
         *  (repo URL + scope chip) sits as a subtitle. Description and
         *  StatGrid follow as supporting copy. */}
        <header className="flex flex-col gap-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-medium"
              style={{ color: TOK.textMuted }}
            >
              Overview
            </span>
            {current.analyzedSubdir && (
              <span
                className="text-[10px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded"
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
          </div>

          {current.repo.description && (
            <p
              className="text-base max-w-3xl leading-relaxed"
              style={{ color: TOK.textSecondary }}
            >
              {current.repo.description}
            </p>
          )}

          <StatGrid snap={current} />

          {current.repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
        </header>

        {/* Orientation + posture (Phase 2 / Moves B + E). The hero owns the
         *  identity (eyebrow + name), so the strip here carries only the "what
         *  to do" lead and the six-dimension status rollup — the "am I okay, at
         *  a glance" the Overview otherwise makes you scroll for. */}
        <OrientationStrip
          line={overviewLine}
          rollup={
            showHealthRollup ? (
              <RollupBar
                segments={healthRollup}
                total={healthSummaries.length}
              />
            ) : undefined
          }
        />

        {/* Since last visit — only when there's a diff */}
        {diff && (
          <SinceLastVisit
            diff={diff}
            repoFullName={current.repo.fullName}
          />
        )}

        {/* Drift (Arc 3) — the most zoomed-out temporal read: multi-sweep
         *  direction of travel. Sits above the current-vs-previous panels
         *  because it answers "where is this heading", not "what just
         *  changed". Hides itself on single-snapshot sessions. */}
        {showDrift && <DriftPanel report={driftReport} />}

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
         *  in lib/intelligence/headline.ts. Phase 2: the page's ONE rationed
         *  light-behind anchor — light magnetizes the eye to the thing that
         *  matters; warm only when the finding is genuinely critical. */}
        <AnchorGlow tone={headline.severity === "critical" ? "warm" : "bone"}>
          <HeadlineFinding headline={headline} sessionId={session.id} />
        </AnchorGlow>

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
        <section className="flex flex-col gap-3" data-rv>
          <div className="flex items-baseline gap-2">
            <span
              className={STYLE.eyebrow}
              style={{ color: TOK.textMuted }}
            >
              Workspace
            </span>
            <span className="text-xs" style={{ color: TOK.textMuted }}>
              · click any card to open
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
                      packageVulnerable > 0 ? ` · ${packageVulnerable} vulnerable` : ""
                    }${packageOutdated > 0 ? ` · ${packageOutdated} outdated` : ""}`
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
              stat="AI summary + health grade"
              description="Grounded in 20 deterministic signals · zero hallucination"
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
        <section className="grid lg:grid-cols-3 gap-4 items-start" data-rv>
          <div className="lg:col-span-2 flex flex-col gap-4">
            <HotspotTreemap hotspots={current.hotspots} sessionId={session.id} />
            <CommitActivity snap={current} />
          </div>
          <div className="flex flex-col gap-4">
            <ContributorList contributors={current.contributors} />
            <LanguageBar languages={current.languages} />
            <BusFactorPanel hotspots={current.hotspots} />
          </div>
        </section>

        {/* Footer — in-product surface, so kept compact. Repo path
         *  is intentionally NOT repeated here (it lives in the hero
         *  + the SessionToolbar's top strip, so a third copy is
         *  redundant noise). Same © / license footer copy as the
         *  marketing landing for cross-surface consistency. */}
        <footer
          className="pt-6 text-[11px] flex items-center justify-between border-t flex-wrap gap-3"
          style={{ borderColor: TOK.border, color: TOK.textMuted }}
        >
          <span>© 2026 CodeTrawl</span>
          <div className="flex items-center gap-4">
            {current.rateLimitInfo && (
              <span className="font-mono tabular-nums">
                Rate limit{" "}
                {current.rateLimitInfo.remaining.toLocaleString()}/
                {current.rateLimitInfo.limit.toLocaleString()}
              </span>
            )}
            <a href="/legal" className="transition hover:underline">
              Privacy &amp; terms
            </a>
            <span>PolyForm Noncommercial 1.0.0</span>
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
      // Material card recipe (diagonal gradient + 1px ambient shadow)
      // matching WorkspaceCard / StatTile across the rest of the app.
      // Hover-lift via translate-y so the cursor's path is rewarded
      // with motion — same pattern as WorkspaceCard.
      className="group flex flex-col gap-2 p-5 rounded-xl transition-all duration-300 hover:-translate-y-0.5"
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
