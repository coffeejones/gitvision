// Home route — RepoJury landing for visitors, the Chambers workspace
// for signed-in users with cases.
//
//   - Anonymous OR signed-in with 0 cases → RepoJuryV2, the
//     forensic-dossier marketing landing (self-contained).
//   - Signed-in with 1+ cases → ChambersHome: the sticky-sidebar app
//     shell with the Cases list, each case a verdict dossier.
//
// The split is decided server-side from the Better Auth session + the
// caller's owned-session count, so the first paint is correct with no
// flash. AuthForm calls router.refresh() after login/logout so the
// branch re-evaluates without a manual reload.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSessions } from "@/lib/storage";
import { filterSessionsByUser } from "@/lib/ownerId";
import { getCases } from "@/lib/intelligence/cases";
import { getSeenMap } from "@/lib/seen";
import { getUserTier } from "@/lib/billing/gates";
import { TIER_CONFIG } from "@/lib/pricing";
import { ChambersHome } from "@/components/chambers/ChambersHome";
import { RepoJuryV2 } from "@/components/landing/repojury/RepoJuryV2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RepoJury — every repo has a verdict",
  description:
    "Put any GitHub repo on trial. Four departments examine health, security, forensics, and supply, then return a verdict you can defend — from one URL, in seconds.",
};

/** Cap on cases projected server-side. Each reads + parses one session
 *  JSON and computes its verdict, so this bounds TTFB for users with
 *  many sessions; older ones still open via direct URL. */
const CASE_CAP = 30;

export default async function Home() {
  const sessions = await listSessions();

  const authSession = await auth.api.getSession({ headers: await headers() });
  const sessionUser = authSession?.user ?? null;

  // Filter to the caller's own sessions once on the server. Drives the
  // marketing/Chambers split + the case projection below.
  const userOwnedSessions = filterSessionsByUser(sessions, sessionUser?.id ?? null);

  // Marketing branch — anonymous, or signed-in with no cases yet. The
  // landing is self-contained, so we return before any projection.
  if (!sessionUser || userOwnedSessions.length === 0) {
    return <RepoJuryV2 />;
  }

  // ── Chambers branch: project the caller's cases + identity ──
  const caseIds = userOwnedSessions.slice(0, CASE_CAP).map((s) => s.id);
  // Seen-map first — it feeds each case's since-last-visit delta.
  const [seenMap, tier] = await Promise.all([
    getSeenMap(sessionUser.id),
    getUserTier(sessionUser.id),
  ]);
  const cases = await getCases(caseIds, seenMap);

  // Rank by what needs attention first: most critical, then lowest
  // score, then most recently filed.
  cases.sort(
    (a, b) =>
      b.criticalCount - a.criticalCount ||
      a.score - b.score ||
      b.updatedAt.localeCompare(a.updatedAt),
  );

  const user = {
    name: sessionUser.name ?? null,
    username: sessionUser.githubLogin ?? null,
    tierName: TIER_CONFIG[tier].name,
    paid: tier !== "open-case",
  };

  return <ChambersHome cases={cases} user={user} />;
}
