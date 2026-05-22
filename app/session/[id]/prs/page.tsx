// /session/[id]/prs — PRs tab as its own route (v0.42).
//
// Two stacked sections:
//   1. PRFlow — historical cycle-time sankey computed from the
//      analyzed repo's pullRequests array
//   2. PRBotCallout — "want this analysis on every new PR?"
//      contextual nudge introducing the RepoBaron GitHub App
//
// The bot callout sits BELOW the historical analysis so reviewers
// see the data first, then the operational tool — the order follows
// the natural mental flow "you've understood the past, here's how
// to automate the future".

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { getUserTier } from "@/lib/billing/gates";
import { PRFlow } from "@/components/views/PRFlow";
import { PRBotCallout } from "@/components/views/PRBotCallout";

export const dynamic = "force-dynamic";

export default async function PRsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  // The PR-flow historical analysis is free for all tiers. The
  // PR-bot installation callout below is tier-gated — Scout sees
  // "Upgrade to install" instead of the Install CTA.
  const authSession = await getAuthSession();
  const userTier = authSession
    ? await getUserTier(authSession.user.id)
    : "scout";

  return (
    <main className="px-8 py-8 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      <div id="screenshot-target" className="flex flex-col gap-4">
        <PRFlow prs={current.pullRequests ?? []} />
      </div>
      <PRBotCallout userTier={userTier} />
    </main>
  );
}
