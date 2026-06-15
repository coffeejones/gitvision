// POST /api/billing/portal — creates a Polar customer portal session
// for the authenticated user and returns the URL to redirect to.
//
// The portal is where users manage their subscription: update billing
// info, view invoices, cancel, upgrade. Polar hosts the entire UI; we
// just hand the user off.
//
// Auth-gated: only logged-in users with an active Polar customer can
// hit this. Users on Free (no Polar customer yet) get a 400.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { createCustomerPortalSession } from "@/lib/billing/polar";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401 },
    );
  }

  // Look up the user's Polar subscription to extract the customer id.
  // Polar's customer portal takes a customer id (not a subscription
  // id) so we fetch the subscription first if needed.
  const rows = await db
    .select({ polarSubscriptionId: schema.user.polarSubscriptionId })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  const subscriptionId = rows[0]?.polarSubscriptionId;
  if (!subscriptionId) {
    return NextResponse.json(
      {
        error:
          "No active subscription. Upgrade to Plus or Pro to access the portal.",
      },
      { status: 400 },
    );
  }

  try {
    // Look up the subscription to get the customer id
    const { getSubscription } = await import("@/lib/billing/polar");
    const subscription = await getSubscription(subscriptionId);
    const customerId = subscription.customerId;

    const portalUrl = await createCustomerPortalSession(customerId);

    return NextResponse.json({ url: portalUrl });
  } catch (err) {
    console.error("[billing/portal] Failed to create portal session:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to create portal session",
      },
      { status: 500 },
    );
  }
}
