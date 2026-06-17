// /cases — the workspace home: the caller's analyzed repositories, each with
// its grade, ranked worst-first. Renders inside the workspace layout
// (which provides the sidebar), so this is content-only.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSessions } from "@/lib/storage";
import { filterSessionsByUser } from "@/lib/ownerId";
import { getCases } from "@/lib/intelligence/cases";
import { getSeenMap } from "@/lib/seen";
import { CasesView } from "@/components/chambers/CasesView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cases — CodeTrawl",
};

/** Cap on cases projected server-side — each reads + verdicts one session. */
const CASE_CAP = 30;

export default async function CasesPage() {
  const authSession = await auth.api.getSession({ headers: await headers() });
  const userId = authSession?.user?.id ?? null;

  const sessions = await listSessions();
  const owned = filterSessionsByUser(sessions, userId);
  const caseIds = owned.slice(0, CASE_CAP).map((s) => s.id);

  const seenMap = userId ? await getSeenMap(userId) : {};
  const cases = await getCases(caseIds, seenMap);

  // Worst-first: most critical, then lowest score, then most recently filed.
  cases.sort(
    (a, b) =>
      b.criticalCount - a.criticalCount ||
      a.score - b.score ||
      b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <CasesView
      publicCases={cases.filter((c) => !c.isPrivate)}
      privateCases={cases.filter((c) => c.isPrivate)}
    />
  );
}
