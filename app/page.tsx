// Home route — adaptive between marketing landing and power-user
// workspace dashboard (v0.69 / C3 polish).
//
// Two distinct experiences live behind the same URL:
//
//   - First-time visitor (no owned sessions in localStorage) →
//     MarketingHome: hero + form + demos + feature grid + footer.
//     The HN/Reddit cold-traffic surface.
//   - Returning power-user (1+ owned sessions) → WorkspaceHome:
//     inline analyze-input + ranked dashboard cards. The
//     "your code dashboard" experience that used to live at
//     /workspace until v0.68; merging it here removes the routing
//     friction (Workspace → Analyze new repo bounced to landing
//     before v0.69).
//
// AdaptiveHome (client) does the localStorage check + render
// switch. Server-side we always compute both data sets — the
// marketing static content and the workspace summaries — so the
// switch is instant and either path renders without an additional
// fetch.

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSessions } from "@/lib/storage";
import { DEMO_OWNER_ID, filterSessionsByUser } from "@/lib/ownerId";
import { getWorkspaceSummaries } from "@/lib/intelligence/workspaceSummary";
import { getDemoCard, type DemoCard } from "@/lib/intelligence/demoCard";
import { type DemoRepo } from "@/components/RepoInputForm";
import { AdaptiveHome } from "@/components/AdaptiveHome";

export const dynamic = "force-dynamic";

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

  // v0.76: login-required model. The workspace listing is gated
  // behind sign-in; anonymous visitors see the marketing landing
  // with demo sessions as the lead-in. Read the Better Auth session
  // server-side so the initial paint matches what the user will see
  // post-hydration (no flash between marketing and workspace).
  const authSession = await auth.api.getSession({
    headers: await headers(),
  });
  const userId = authSession?.user.id ?? null;

  // Filter to the caller's own sessions ONCE on the server. Both
  // `initialSessions` (sent to the client) and `workspaceSummaries`
  // (the rich projection for the dashboard cards) are derived from
  // this filtered list. Two things this fixes:
  //   1. Privacy: we never ship other users' session metadata down
  //      the wire just for the client to filter it back out.
  //   2. Hydration flash: the initial server paint of WorkspaceHome
  //      used to render with ALL workspaceSummaries until client
  //      hydration filtered them down to the user's own. That
  //      "wrong sessions flash for a split second, then mine appear"
  //      bug is gone now that the server sends only the right set.
  const userOwnedSessions = filterSessionsByUser(sessions, userId);

  // Workspace summaries — projected for the caller's own most-recent
  // sessions only. Cap bounds TTFB on users with many sessions; the
  // rest stay on disk and are reachable via direct URL.
  const summaryIds = userOwnedSessions
    .slice(0, WORKSPACE_SUMMARY_CAP)
    .map((s) => s.id);
  const workspaceSummaries = await getWorkspaceSummaries(summaryIds);

  const initialLayout: "marketing" | "workspace" =
    userOwnedSessions.length > 0 ? "workspace" : "marketing";

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
      initialLayout={initialLayout}
      // Pass auth state explicitly. MarketingHome can't read
      // next/headers itself — it gets pulled into the client bundle
      // through AdaptiveHome — so we thread the server-decided value
      // through. AdaptiveHome overrides this with useSession() once
      // hydrated.
      initialLoggedIn={userId !== null}
    />
  );
}
