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
import { resolveSubscriptionUpdate } from "@/lib/billing/polar";

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
      // Detailed debug logging to diagnose signature mismatches.
      // Logs the headers Polar sent + secret length (NOT the secret
      // itself) so we can spot misconfiguration without leaking
      // credentials.
      const headerKeys = Object.keys(headers).filter(
        (k) =>
          k.startsWith("webhook-") ||
          k.startsWith("polar-") ||
          k === "content-type",
      );
      console.warn(
        "[polar/webhook] Signature verification failed:",
        err.message,
        "\n  Webhook headers received:",
        headerKeys.map((k) => `${k}=${headers[k].slice(0, 12)}...`).join(", "),
        "\n  POLAR_WEBHOOK_SECRET length:",
        secret.length,
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

  // All subscription.* events have a .data with the subscription object.
  // SDK guarantees the core fields; `customer` is optional but feeds the
  // userId fallback below.
  const sub = event.data as {
    id: string;
    status: string;
    productId: string;
    currentPeriodEnd?: string | Date | null;
    cancelAtPeriodEnd?: boolean | null;
    metadata?: Record<string, unknown> | null;
    customer?: {
      email?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
  };

  // Map the payment back to a CodeTrawl user. See resolveUserId — tries
  // subscription metadata, then customer metadata, then an email match,
  // because Polar doesn't reliably copy checkout metadata onto a new
  // subscription. Without the fallback, a paid checkout could strand the
  // customer on Free with no recovery.
  const userId = await resolveUserId(sub);
  if (!userId) {
    console.error(
      `[polar/webhook] Event ${event.type} could not resolve a user (no subscription/customer metadata.userId, no email match) — subscription ${sub.id}`,
    );
    // Return 200 so Polar stops retrying — retrying won't supply the
    // missing identity; this needs manual reconciliation.
    return NextResponse.json({
      ok: true,
      handled: false,
      reason: "unresolved user",
    });
  }

  // Decide what tier + status to write. Pure + unit-tested in
  // lib/__tests__/polarWebhook.test.ts. Critically, it SKIPS the write
  // (rather than downgrading to Free) when a paid-state event carries a
  // product id we don't recognise — so a sandbox/prod mismatch can't
  // silently demote a paying customer.
  const decision = resolveSubscriptionUpdate(event.type, sub);
  if (decision.kind === "skip") {
    console.warn(
      `[polar/webhook] ${event.type} for user ${userId}: ${decision.reason}`,
    );
    return NextResponse.json({
      ok: true,
      handled: false,
      reason: decision.reason,
    });
  }
  const tierToSet = decision.tier;
  const statusToSet = decision.status;

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

/** Resolve the CodeTrawl user id for a Polar subscription event. Tries, in
 *  order: subscription.metadata.userId → customer.metadata.userId → a lookup
 *  by the customer's email. Returns null when none resolve, so the caller can
 *  flag it for manual reconciliation instead of mutating the wrong row. */
async function resolveUserId(sub: {
  metadata?: Record<string, unknown> | null;
  customer?: {
    email?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}): Promise<string | null> {
  const fromSub = sub.metadata?.userId;
  if (typeof fromSub === "string" && fromSub) return fromSub;

  const fromCustomer = sub.customer?.metadata?.userId;
  if (typeof fromCustomer === "string" && fromCustomer) return fromCustomer;

  const email = sub.customer?.email;
  if (email) {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (rows[0]?.id) return rows[0].id;
  }

  return null;
}
