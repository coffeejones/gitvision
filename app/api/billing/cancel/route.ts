// POST /api/billing/cancel — schedule (or reverse) cancellation of the
// authenticated user's subscription, from inside the app.
//
//   { }                  → cancel at period end (keeps tier until it lapses)
//   { "resume": true }   → reverse a pending cancellation
//
// We deliberately cancel-at-period-end, never revoke immediately: a paying
// customer keeps what they paid for until the period they already paid for
// runs out. Polar drops them to Free at that boundary via the webhook.
//
// Security: the subscription id comes from the user's OWN row, never the
// request — a user can only cancel their own subscription.
//
// The webhook is authoritative; we also mirror cancelAtPeriodEnd optimistically
// so the "Canceling" badge + "Plan ends on" copy appear immediately.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { setSubscriptionCancelAtPeriodEnd } from "@/lib/billing/polar";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { resume?: boolean };
  const cancel = body.resume !== true;

  const rows = await db
    .select({ polarSubscriptionId: schema.user.polarSubscriptionId })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  const subscriptionId = rows[0]?.polarSubscriptionId;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "No active subscription to cancel." },
      { status: 400 },
    );
  }

  try {
    await setSubscriptionCancelAtPeriodEnd(subscriptionId, cancel);

    // Optimistic mirror — the webhook will confirm/correct shortly.
    await db
      .update(schema.user)
      .set({ cancelAtPeriodEnd: cancel })
      .where(eq(schema.user.id, session.user.id));

    return NextResponse.json({ ok: true, cancelAtPeriodEnd: cancel });
  } catch (err) {
    console.error("[billing/cancel] Failed to update cancellation:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to update subscription",
      },
      { status: 500 },
    );
  }
}
