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

import { listSessions } from "@/lib/storage";
import { DEMO_OWNER_ID, filterSessionsByOwner } from "@/lib/ownerId";
import { getOwnerIdFromCookies } from "@/lib/ownerIdServer";
import { getWorkspaceSummaries } from "@/lib/intelligence/workspaceSummary";
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

  // Workspace summaries — projected for the most-recent N sessions.
  // AdaptiveHome filters this client-side via ownerId before deciding
  // whether to render WorkspaceHome.
  const summaryIds = sessions
    .slice(0, WORKSPACE_SUMMARY_CAP)
    .map((s) => s.id);
  const workspaceSummaries = await getWorkspaceSummaries(summaryIds);

  // v0.69: read ownerId from cookie (mirrored from localStorage by
  // getOrCreateOwnerId on the client) so we can pre-decide the
  // initial layout server-side. Without this the server always
  // renders marketing — power-users then get a visible flash on
  // hydration when the swap to WorkspaceHome happens. With the
  // cookie present, server picks the right layout up front and
  // hydration is silent.
  const ownerIdFromCookie = await getOwnerIdFromCookies();
  const userOwnedSessions = ownerIdFromCookie
    ? filterSessionsByOwner(sessions, ownerIdFromCookie)
    : [];
  const initialLayout: "marketing" | "workspace" =
    userOwnedSessions.length > 0 ? "workspace" : "marketing";

  return (
    <AdaptiveHome
      demoRepos={DEMO_REPOS}
      demoSessions={demoSessions}
      initialSessions={sessions}
      workspaceSummaries={workspaceSummaries}
      // Bug fix (2026-05-16): was sessions.length — that counted ALL
      // sessions on disk (including other users' sessions), so the
      // "Showing N of M" hint in WorkspaceHome showed inflated totals
      // like "1 of 68" when the caller only owns 1 session. Filter
      // by cookie first so M represents the caller's actual total.
      // AdaptiveHome may further override post-hydration if the
      // client-side cookie state differs from the server's view.
      totalOnDisk={userOwnedSessions.length}
      initialLayout={initialLayout}
    />
  );
}
