// POST /api/billing/change-plan — switch the authenticated user's existing
// Polar subscription to a different paid tier (Plus ⇄ Pro) from inside the
// app, so paying customers don't have to go hunting through the Polar portal.
//
// Design (Jonas's explicit choices):
//   - Proration: org default. We send ONLY the productId, letting Polar apply
//     whatever proration the organisation has configured in its dashboard.
//   - Billing cycle: preserved. We read the subscription's current product to
//     learn whether the user is on monthly or annual, then target the SAME
//     cycle on the new tier.
//
// Security: the subscription id comes from the user's OWN row, never the
// request body — a user can only ever modify their own subscription. The
// target tier is validated against the two paid tiers.
//
// The subscription.updated webhook is authoritative and will mirror the new
// tier in; we also write optimistically here so the UI reflects the change
// immediately without waiting on the webhook round-trip.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import type { Tier } from "@/components/TierIcon";
import {
  getSubscription,
  productIdFor,
  tierFromProductId,
  changeSubscriptionProduct,
} from "@/lib/billing/polar";

const PAID_TIERS: ReadonlySet<Exclude<Tier, "open-case">> = new Set([
  "standing-docket",
  "full-bench",
]);

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { tier?: string };
  const targetTier = body.tier as Exclude<Tier, "open-case"> | undefined;
  if (!targetTier || !PAID_TIERS.has(targetTier)) {
    return NextResponse.json(
      { error: "Invalid target tier. Expected standing-docket or full-bench." },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      tier: schema.user.tier,
      polarSubscriptionId: schema.user.polarSubscriptionId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  const current = rows[0];
  const subscriptionId = current?.polarSubscriptionId;
  if (!subscriptionId) {
    return NextResponse.json(
      {
        error:
          "No active subscription to change. Upgrade to Plus or Pro first.",
      },
      { status: 400 },
    );
  }
  if (current?.tier === targetTier) {
    return NextResponse.json(
      { error: "You're already on that plan." },
      { status: 400 },
    );
  }

  try {
    // Read the live subscription to learn the current billing cycle, so the
    // switch preserves monthly/annual rather than silently flipping it.
    const subscription = await getSubscription(subscriptionId);
    const currentProductId =
      typeof subscription.productId === "string"
        ? subscription.productId
        : subscription.product?.id;
    const currentBilling =
      (currentProductId && tierFromProductId(currentProductId)?.billing) ||
      "monthly";

    const targetProductId = productIdFor(targetTier, currentBilling);

    await changeSubscriptionProduct(subscriptionId, targetProductId);

    // Optimistic mirror — the webhook will confirm/correct shortly.
    await db
      .update(schema.user)
      .set({ tier: targetTier })
      .where(eq(schema.user.id, session.user.id));

    return NextResponse.json({ ok: true, tier: targetTier });
  } catch (err) {
    console.error("[billing/change-plan] Failed to change plan:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to change plan",
      },
      { status: 500 },
    );
  }
}
