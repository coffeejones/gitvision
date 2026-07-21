// /session/[id]/prs — PRs tab as its own route (v0.42).
//
// Two stacked sections:
//   1. PRFlow — historical cycle-time sankey computed from the
//      analyzed repo's pullRequests array
//   2. PRBotCallout — "want this analysis on every new PR?"
//      contextual nudge introducing the CodeTrawl GitHub App
//
// The bot callout sits BELOW the historical analysis so reviewers
// see the data first, then the operational tool — the order follows
// the natural mental flow "you've understood the past, here's how
// to automate the future".

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { getUserTier } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { PRFlow } from "@/components/views/PRFlow";
import { PRBotCallout } from "@/components/views/PRBotCallout";
import { OrientationStrip } from "@/components/views/OrientationStrip";

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
  // PR-bot installation callout below is tier-gated — Free sees
  // "Upgrade to install" instead of the Install CTA. Public demo
  // sessions present the callout in its full (paid) form so visitors
  // see the feature, not an upsell.
  const authSession = await getAuthSession();
  const userTier = isDemoSession(id)
    ? "full-bench"
    : authSession
      ? await getUserTier(authSession.user.id)
      : "open-case";

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      <OrientationStrip
        eyebrow="PRs"
        title="How pull requests resolve."
        line="Where human PRs ended up, and how long merges took. Start with the split below, then trace the slow flows. Automated PRs are excluded."
      />
      <div id="screenshot-target" className="flex flex-col gap-4">
        <PRFlow prs={current.pullRequests ?? []} />
      </div>
      <div data-rv>
        <PRBotCallout userTier={userTier} />
      </div>
    </main>
  );
}
