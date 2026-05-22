// POST /api/polar/webhook — receives Polar.sh subscription lifecycle
// events and mirrors state into our user table.
//
// Signature verification uses @polar-sh/sdk's validateEvent helper,
// which implements the Standard Webhooks spec Polar follows:
//   - webhook-id, webhook-timestamp, webhook-signature headers
//   - Signed payload is `${id}.${timestamp}.${body}`, not just body
//   - HMAC-SHA256 → base64
// My first attempt did a naive HMAC of body alone with a "polar-
// signature" header — both wrong. The SDK helper gets it right and
// returns a typed event object, so downstream code is also safer.
//
// Idempotency: Polar may retry webhooks. The handler is idempotent —
// same event arriving twice produces the same DB state, no duplicate
// operations. Triggered by the user.id+subscription.id uniqueness on
// our user table updates.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { tierFromProductId } from "@/lib/billing/polar";
import type { Tier } from "@/components/TierIcon";

/** Polar webhook event types we handle. Anything else returns 200
 *  (so Polar stops retrying) but performs no state change. */
const HANDLED_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.revoked",
  "subscription.uncanceled",
  "subscription.past_due",
]);

export async function POST(req: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[polar/webhook] POLAR_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  // Read raw body bytes — needed for signature verification against
  // the exact payload Polar signed
  const rawBody = await req.text();

  // Polar SDK's validateEvent expects headers as a plain object, not
  // the Next.js Headers iterator. Convert.
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Verify signature + parse into a typed event. Throws
  // WebhookVerificationError on invalid signature.
  let event: ReturnType<typeof validateEvent>;
  try {
    event = validateEvent(rawBody, headers, secret);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn(
        "[polar/webhook] Signature verification failed — rejecting",
        err.message,
      );
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
    console.error("[polar/webhook] Unexpected error parsing event:", err);
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 },
    );
  }

  // Silently ack non-subscription events (we don't process them, but
  // returning 200 stops Polar from retrying indefinitely)
  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ ok: true, handled: false });
  }

  // All subscription.* events have a .data with the subscription
  // object — extract fields we care about. SDK guarantees the shape.
  const sub = event.data as {
    id: string;
    status: string;
    productId: string;
    currentPeriodEnd?: string | Date | null;
    cancelAtPeriodEnd?: boolean | null;
    metadata?: Record<string, unknown> | null;
  };

  const userIdRaw = sub.metadata?.userId;
  const userId = typeof userIdRaw === "string" ? userIdRaw : null;
  if (!userId) {
    console.error(
      `[polar/webhook] Event ${event.type} missing metadata.userId — subscription ${sub.id}`,
    );
    // Still return 200 so Polar doesn't retry forever — the issue is
    // upstream (checkout didn't include metadata) and retrying won't
    // help.
    return NextResponse.json(
      { ok: true, handled: false, reason: "missing userId" },
    );
  }

  // Resolve tier from product id via lib/pricing.ts — single source
  // of truth so adding a new tier later doesn't require updating
  // both places
  const tierInfo = tierFromProductId(sub.productId);

  // Decide what tier + status to write
  let tierToSet: Tier;
  let statusToSet: string;

  if (event.type === "subscription.revoked") {
    // Payment failed irrecoverably — immediate downgrade to scout
    tierToSet = "scout";
    statusToSet = "revoked";
  } else if (event.type === "subscription.canceled") {
    // User canceled but still in paid period — keep tier, mark status
    tierToSet = (tierInfo?.tier ?? "scout") as Tier;
    statusToSet = "canceled";
  } else if (event.type === "subscription.past_due") {
    // Grace period after failed invoice — keep tier, mark status
    tierToSet = (tierInfo?.tier ?? "scout") as Tier;
    statusToSet = "past_due";
  } else if (sub.status === "trialing") {
    // Inside 14-day trial — full access
    tierToSet = (tierInfo?.tier ?? "scout") as Tier;
    statusToSet = "trialing";
  } else if (sub.status === "active") {
    tierToSet = (tierInfo?.tier ?? "scout") as Tier;
    statusToSet = "active";
  } else {
    // Unknown / unexpected status — log and skip update
    console.warn(
      `[polar/webhook] Skipping event ${event.type} with status="${sub.status}" for user ${userId}`,
    );
    return NextResponse.json({ ok: true, handled: false });
  }

  const currentPeriodEnd = sub.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd)
    : null;
  const cancelAtPeriodEnd = !!sub.cancelAtPeriodEnd;

  try {
    await db
      .update(user)
      .set({
        tier: tierToSet,
        polarSubscriptionId: sub.id,
        subscriptionStatus: statusToSet,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));

    console.log(
      `[polar/webhook] ${event.type} → user ${userId} tier=${tierToSet} status=${statusToSet}`,
    );
    return NextResponse.json({ ok: true, handled: true });
  } catch (err) {
    console.error("[polar/webhook] DB update failed:", err);
    return NextResponse.json(
      { error: "DB update failed" },
      { status: 500 },
    );
  }
}
