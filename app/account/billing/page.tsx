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
import { AccountShell } from "@/components/AccountShell";
import { BillingPanel } from "@/components/account/BillingPanel";
import type { Tier } from "@/components/TierIcon";

export const metadata = {
  title: "Billing — Account — RepoBaron",
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
  const tier = (subscription?.tier ?? "scout") as Tier;

  // Pull the accounts list for the AccountShell hero badges
  const accountRows = await db
    .select({
      providerId: schema.account.providerId,
      hasPassword: schema.account.password,
    })
    .from(schema.account)
    .where(eq(schema.account.userId, session.user.id));

  const hasPassword = accountRows.some(
    (r) => r.providerId === "credential" && r.hasPassword !== null,
  );
  const hasGithub = accountRows.some((r) => r.providerId === "github");
  const user = userFromSession(session);

  return (
    <AccountShell
      user={user}
      hasPassword={hasPassword}
      hasGithub={hasGithub}
    >
      <BillingPanel
        tier={tier}
        subscriptionStatus={subscription?.subscriptionStatus ?? null}
        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
        hasSubscriptionId={!!subscription?.polarSubscriptionId}
      />
    </AccountShell>
  );
}
