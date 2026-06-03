// /account/billing — subscription management section of the Account
// page (v0.78 / Pricing P5).
//
// Server Component. Reads the user's tier + subscription state from
// the DB, then hands off to BillingPanel (client) for the interactive
// portal-link + flash-banner UI.
//
// Polar redirects here after successful checkout with ?upgraded=1,
// which BillingPanel reads to show a welcome message.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { db, schema } from "@/lib/db";
import { SettingsShell } from "@/components/account/SettingsShell";
import { BillingPanel } from "@/components/account/BillingPanel";
import { getUserTier } from "@/lib/billing/gates";

export const metadata = {
  title: "Billing — Account — RepoJury",
  description: "Your subscription tier and billing settings.",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/billing");

  // Fetch the user's subscription state from DB
  const rows = await db
    .select({
      tier: schema.user.tier,
      subscriptionStatus: schema.user.subscriptionStatus,
      currentPeriodEnd: schema.user.currentPeriodEnd,
      cancelAtPeriodEnd: schema.user.cancelAtPeriodEnd,
      polarSubscriptionId: schema.user.polarSubscriptionId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  const subscription = rows[0];
  // Validated tier (whitelists known keys, defaults legacy/unknown to
  // open-case) — never the raw DB string, which could be a pre-rename value
  // that isn't a TIER_CONFIG key and would crash BillingPanel.
  const tier = await getUserTier(session.user.id);
  const user = userFromSession(session);

  return (
    <SettingsShell user={user}>
      <BillingPanel
        tier={tier}
        subscriptionStatus={subscription?.subscriptionStatus ?? null}
        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
        hasSubscriptionId={!!subscription?.polarSubscriptionId}
      />
    </SettingsShell>
  );
}
