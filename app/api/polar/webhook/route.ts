// POST /api/polar/webhook — receives Polar.sh subscription lifecycle
// events and mirrors state into our user table.
//
// Events we handle:
//   subscription.created   — first time user pays / trial starts
//   subscription.updated   — billing period rolls over, plan changes
//   subscription.canceled  — user cancels (still in paid period)
//   subscription.revoked   — payment failed, immediate downgrade
//
// Security: Polar signs every webhook with HMAC-SHA256 using
// POLAR_WEBHOOK_SECRET. We verify the signature before trusting any
// payload. Without verification, anyone could POST fake events to
// upgrade users for free.
//
// Idempotency: Polar may retry webhooks on transient errors. Our
// handler is idempotent — same event arriving twice produces the
// same DB state, no duplicate operations.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { tierFromProductId } from "@/lib/billing/polar";

/** Polar webhook event types we handle. Other events are ack'd
 *  (returned 200) but not processed — we don't want Polar's retry
 *  queue to fire for events we silently ignore. */
const HANDLED_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.revoked",
  "subscription.active",
]);

interface PolarSubscriptionPayload {
  type: string;
  data: {
    id: string;
    status: string;
    productId?: string;
    product_id?: string;
    currentPeriodEnd?: string;
    current_period_end?: string;
    cancelAtPeriodEnd?: boolean;
    cancel_at_period_end?: boolean;
    metadata?: {
      userId?: string;
      tier?: string;
      billing?: string;
    };
  };
}

/** Verify the Polar webhook signature using HMAC-SHA256. Returns
 *  true if the signature matches, false otherwise. */
function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  // Constant-time comparison to avoid timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[polar/webhook] POLAR_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  // Read raw body so we can verify the signature against the exact
  // bytes Polar signed (NOT a re-serialized version, which may
  // differ in whitespace / key order).
  const rawBody = await req.text();
  const signature = req.headers.get("polar-signature");

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn(
      "[polar/webhook] Signature verification failed — rejecting",
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  let event: PolarSubscriptionPayload;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 },
    );
  }

  // Silently ack events we don't handle (Polar keeps retrying
  // anything that doesn't return 2xx)
  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ ok: true, handled: false });
  }

  const data = event.data;
  const userId = data.metadata?.userId;
  if (!userId) {
    console.error(
      `[polar/webhook] Event ${event.type} missing metadata.userId — payload:`,
      JSON.stringify(data),
    );
    return NextResponse.json(
      { error: "Missing userId metadata" },
      { status: 400 },
    );
  }

  // Resolve tier from product id (more robust than trusting
  // metadata.tier, since product → tier mapping lives in lib/pricing.ts)
  const productId = data.productId ?? data.product_id;
  const tierInfo = productId ? tierFromProductId(productId) : null;

  const subscriptionId = data.id;
  const status = data.status;
  const currentPeriodEnd =
    data.currentPeriodEnd ?? data.current_period_end;
  const cancelAtPeriodEnd =
    data.cancelAtPeriodEnd ?? data.cancel_at_period_end ?? false;

  // Build the user-row update based on event type
  let tierToSet: "scout" | "knight" | "baron";
  let statusToSet: string | null;

  if (event.type === "subscription.revoked") {
    // Payment failed irrecoverably — immediate downgrade to scout
    tierToSet = "scout";
    statusToSet = "revoked";
  } else if (
    event.type === "subscription.canceled" ||
    cancelAtPeriodEnd
  ) {
    // User cancelled but still in paid period — keep tier, mark status
    tierToSet = (tierInfo?.tier ?? "scout") as
      | "scout"
      | "knight"
      | "baron";
    statusToSet = "canceled";
  } else if (status === "trialing") {
    // Inside 14-day trial — full access
    tierToSet = (tierInfo?.tier ?? "scout") as
      | "scout"
      | "knight"
      | "baron";
    statusToSet = "trialing";
  } else if (status === "active") {
    tierToSet = (tierInfo?.tier ?? "scout") as
      | "scout"
      | "knight"
      | "baron";
    statusToSet = "active";
  } else if (status === "past_due") {
    // Last invoice failed but still in grace — keep tier
    tierToSet = (tierInfo?.tier ?? "scout") as
      | "scout"
      | "knight"
      | "baron";
    statusToSet = "past_due";
  } else {
    // Unknown status — log and don't touch the user
    console.warn(
      `[polar/webhook] Unknown status "${status}" on event ${event.type} for user ${userId}`,
    );
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    await db
      .update(user)
      .set({
        tier: tierToSet,
        polarSubscriptionId: subscriptionId,
        subscriptionStatus: statusToSet,
        currentPeriodEnd: currentPeriodEnd
          ? new Date(currentPeriodEnd)
          : null,
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
