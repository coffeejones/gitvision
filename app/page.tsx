// Home route — RepoJury landing for visitors, workspace dashboard for
// power-users (v0.69 / C3 → Phase R: landing moved to root).
//
// Two distinct experiences behind "/":
//
//   - Anonymous OR logged-in with 0 owned sessions → RepoJury, the
//     forensic-dossier marketing landing (self-contained — no demo
//     payload needed). The cold-traffic conversion surface.
//   - Logged-in power-user (1+ owned sessions) → WorkspaceHome via
//     AdaptiveHome: inline analyze-input + ranked dashboard cards.
//
// The split is decided server-side from the Better Auth session +
// owned-session count, so the first paint is correct with no flash.
// We only compute the (bounded) demo + workspace payloads on the
// power-user branch — marketing visitors skip all of it.
//
// AuthForm calls router.refresh() after login/logout, so transitions
// between the two branches re-run this server component and land on
// the right experience without a manual reload.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSessions } from "@/lib/storage";
import { DEMO_OWNER_ID, filterSessionsByUser } from "@/lib/ownerId";
import { getWorkspaceSummaries } from "@/lib/intelligence/workspaceSummary";
import { getDemoCard, type DemoCard } from "@/lib/intelligence/demoCard";
import { type DemoRepo } from "@/components/RepoInputForm";
import { AdaptiveHome } from "@/components/AdaptiveHome";
import { RepoJury } from "@/components/landing/repojury/RepoJury";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RepoJury — every repo has a verdict",
  description:
    "Put any GitHub repo on trial. Four departments examine health, security, forensics, and supply, then return a verdict you can defend — from one URL, in seconds.",
};

// Curated demo set. One entry per AST-backed plugin so the row showcases
// the plugin architecture at a glance. Each pick is small/medium-sized —
// large repos like vercel/next.js or torvalds/linux risk hitting the 25s
// codeAnalysis timeout (see lib/github.ts) and degrading to "Code analysis
// was skipped", which is a poor first impression.
const DEMO_REPOS: DemoRepo[] = [
  { repo: "colinhacks/zod", lang: "TypeScript" },
  { repo: "gin-gonic/gin", lang: "Go" },
  { repo: "pallets/flask", lang: "Python" },
  { repo: "spring-projects/spring-petclinic", lang: "Java" },
];

/** Cap on workspace summaries computed server-side. Each summary
 *  reads + parses one session JSON, so this bounds TTFB on power-
 *  users with many sessions. Above the cap, older sessions still
 *  exist on disk but won't appear in the workspace cards. */
const WORKSPACE_SUMMARY_CAP = 30;

export default async function Home() {
  const sessions = await listSessions();

  // v0.76: login-required model. The workspace listing is gated
  // behind sign-in; anonymous visitors see the marketing landing.
  // Read the Better Auth session server-side so the split is decided
  // before any rendering.
  const authSession = await auth.api.getSession({
    headers: await headers(),
  });
  const userId = authSession?.user.id ?? null;

  // Filter to the caller's own sessions ONCE on the server. Drives
  // both the marketing/workspace split below and the rich projection
  // for the dashboard cards.
  const userOwnedSessions = filterSessionsByUser(sessions, userId);

  // Phase R: marketing branch — anonymous or zero-session visitors get
  // the RepoJury landing. It's self-contained (no demo payload), so we
  // return before computing any of the workspace projections below.
  if (userOwnedSessions.length === 0) {
    return <RepoJury />;
  }

  // ── Power-user branch: compute the workspace dashboard payloads ──

  // v0.53: build a `repoFullName → sessionId` map for demo-tagged
  // sessions so the LandingPanel can wire each demo button to a
  // direct navigation instead of triggering a fresh 20-second
  // analysis. Falls back to the prior pre-fill behaviour when a
  // demo button has no pre-analyzed counterpart on disk.
  //
  // Built from the unfiltered `sessions` list because demo sessions
  // have ownerId === "demo" — they don't belong to any user, but
  // every user should be able to open them.
  const demoSessions: Record<string, string> = {};
  for (const s of sessions) {
    if (s.ownerId !== DEMO_OWNER_ID) continue;
    const existing = demoSessions[s.repoFullName];
    if (!existing) {
      demoSessions[s.repoFullName] = s.id;
    } else {
      const olderUpdatedAt =
        sessions.find((x) => x.id === existing)?.updatedAt ?? "";
      if (s.updatedAt > olderUpdatedAt) {
        demoSessions[s.repoFullName] = s.id;
      }
    }
  }

  // v0.76 D4: rich demo cards — each pre-built session gets both a
  // WorkspaceSummary (for the headline/severity) AND a scale-stats
  // payload (stars, files, functions, hotspots). Single JSON parse
  // per session via getDemoCard. Bounded to the four DEMO_REPOS
  // entries so cost is fixed.
  const demoCards: Record<string, DemoCard> = {};
  await Promise.all(
    Object.entries(demoSessions).map(async ([repoFullName, sessionId]) => {
      const card = await getDemoCard(sessionId);
      if (card) demoCards[repoFullName] = card;
    }),
  );

  // Workspace summaries — projected for the caller's own most-recent
  // sessions only. Cap bounds TTFB on users with many sessions; the
  // rest stay on disk and are reachable via direct URL.
  const summaryIds = userOwnedSessions
    .slice(0, WORKSPACE_SUMMARY_CAP)
    .map((s) => s.id);
  const workspaceSummaries = await getWorkspaceSummaries(summaryIds);

  return (
    <AdaptiveHome
      demoRepos={DEMO_REPOS}
      demoSessions={demoSessions}
      demoCards={demoCards}
      // Already filtered to the caller's own sessions (incl. legacy
      // open ones, excl. demo + other users'). AdaptiveHome still
      // re-runs filterSessionsByUser as a defensive net in case the
      // client's auth state diverges from the server's, but the
      // happy path is a no-op now.
      initialSessions={userOwnedSessions}
      workspaceSummaries={workspaceSummaries}
      totalOnDisk={userOwnedSessions.length}
      // This branch only runs for power-users (1+ owned sessions), so
      // the layout is always "workspace" and the caller is logged in.
      initialLayout="workspace"
      initialLoggedIn={userId !== null}
    />
  );
}
