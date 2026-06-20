// Polar.sh API client wrapper.
//
// We use Polar as Merchant of Record — they handle VAT, sales tax,
// payment processing, customer support refunds, and the actual
// checkout UI. Our job is:
//   1. Create checkout sessions (server-side, with userId metadata
//      so the webhook can map the payment back to a CodeTrawl user)
//   2. Handle subscription lifecycle webhooks (created, updated,
//      canceled, revoked) and mirror state into our user table
//
// Server-only — never import this from a Client Component. The SDK
// uses POLAR_API_KEY which we don't ship to the browser.

import { Polar } from "@polar-sh/sdk";
import type { Tier } from "@/components/TierIcon";
import { TIER_CONFIG } from "@/lib/pricing";

/** Polar SDK instance. Reads POLAR_API_KEY + POLAR_SERVER from env.
 *  POLAR_SERVER should be "production" for live and "sandbox" for
 *  testing — defaults to "production" if unset. */
function polarClient(): Polar {
  const accessToken = process.env.POLAR_API_KEY;
  if (!accessToken) {
    throw new Error(
      "POLAR_API_KEY is not configured. Add it to .env.local + Railway.",
    );
  }
  const server = (process.env.POLAR_SERVER ?? "production") as
    | "production"
    | "sandbox";
  return new Polar({ accessToken, server });
}

interface CreateCheckoutInput {
  /** Tier the user is upgrading to */
  tier: Exclude<Tier, "open-case">;
  /** Monthly or annual billing */
  billing: "monthly" | "annual";
  /** Authenticated CodeTrawl user id — flows to webhook via metadata */
  userId: string;
  /** Pre-fill email on the Polar checkout form for lower friction */
  userEmail: string;
  /** Where to send the user after successful checkout */
  successUrl: string;
}

interface CreateCheckoutResult {
  /** Polar-hosted checkout URL to redirect the user to */
  url: string;
  /** Polar's own session id (useful for analytics, refunds) */
  checkoutId: string;
}

/** Per-(tier, billing) env var that overrides the hardcoded product id in
 *  lib/pricing.ts. Lets each environment (production vs sandbox) point at its
 *  own Polar products without a code change, and is the recommended seam for
 *  fixing a wrong / rotated product id: set the env var and redeploy — no
 *  code edit. (This also closes the audit's hardcoded-id risk.) */
const PRODUCT_ENV: Record<
  Exclude<Tier, "open-case">,
  { monthly: string; annual: string }
> = {
  "standing-docket": {
    monthly: "POLAR_PRODUCT_PLUS_MONTHLY",
    annual: "POLAR_PRODUCT_PLUS_ANNUAL",
  },
  "full-bench": {
    monthly: "POLAR_PRODUCT_PRO_MONTHLY",
    annual: "POLAR_PRODUCT_PRO_ANNUAL",
  },
};

/** The configured Polar product id for a (tier, billing): the env override
 *  when set, else the lib/pricing.ts default. "" only when neither is set. */
function resolvedProductId(
  tier: Exclude<Tier, "open-case">,
  billing: "monthly" | "annual",
): string {
  const fromEnv = process.env[PRODUCT_ENV[tier][billing]]?.trim();
  if (fromEnv) return fromEnv;
  const config = TIER_CONFIG[tier];
  return billing === "monthly"
    ? config.polarProductIdMonthly
    : config.polarProductIdAnnual;
}

/** Resolve the Polar product id for a (tier, billing) — env override first,
 *  then the lib/pricing.ts default. Throws if neither is configured
 *  (defensive — prevents sending users to an empty checkout). */
function productIdFor(
  tier: Exclude<Tier, "open-case">,
  billing: "monthly" | "annual",
): string {
  const id = resolvedProductId(tier, billing);
  if (!id) {
    throw new Error(
      `No Polar product id for tier="${tier}" billing="${billing}". Set ${PRODUCT_ENV[tier][billing]} or update lib/pricing.ts.`,
    );
  }
  return id;
}

/** Create a Polar checkout session. Returns the URL to redirect the
 *  user to. The session carries metadata (userId, tier, billing) so
 *  the webhook handler can update the right user when payment
 *  succeeds. */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
  const client = polarClient();
  const productId = productIdFor(input.tier, input.billing);

  const checkout = await client.checkouts.create({
    products: [productId],
    customerEmail: input.userEmail,
    successUrl: input.successUrl,
    metadata: {
      userId: input.userId,
      tier: input.tier,
      billing: input.billing,
    },
    // Also stamp the userId on the CUSTOMER. Polar does not reliably copy
    // checkout-level metadata onto a brand-new subscription's metadata, so
    // the webhook reads customer.metadata.userId as a fallback when
    // subscription.metadata is empty (see resolveUserId in the webhook).
    customerMetadata: {
      userId: input.userId,
    },
  });

  return {
    url: checkout.url,
    checkoutId: checkout.id,
  };
}

/** Look up a subscription by Polar id. Used by webhook handler to
 *  fetch full subscription state when an event arrives, since some
 *  webhook payloads omit fields we want (e.g. `currentPeriodEnd`). */
export async function getSubscription(subscriptionId: string) {
  const client = polarClient();
  return await client.subscriptions.get({ id: subscriptionId });
}

/** Generate a Polar customer-portal URL for an existing customer.
 *  We use this for the "Manage subscription" button on the
 *  /account/billing page — Polar handles the cancellation, billing-
 *  info-update, and invoice-download UI for us. */
export async function createCustomerPortalSession(
  customerId: string,
): Promise<string> {
  const client = polarClient();
  const session = await client.customerSessions.create({
    customerId,
  });
  return session.customerPortalUrl;
}

/** Map a Polar product id back to (tier, billing). Used by webhook
 *  handler to translate the product the user actually subscribed to
 *  into our internal tier representation. */
export function tierFromProductId(
  productId: string,
): { tier: Tier; billing: "monthly" | "annual" } | null {
  if (!productId) return null;
  // Match against the ENV-resolved ids so a webhook event carrying the
  // env-configured product resolves to the right tier (not just the
  // hardcoded defaults).
  for (const tier of ["standing-docket", "full-bench"] as const) {
    if (resolvedProductId(tier, "monthly") === productId) {
      return { tier, billing: "monthly" };
    }
    if (resolvedProductId(tier, "annual") === productId) {
      return { tier, billing: "annual" };
    }
  }
  return null;
}

/** Outcome of mapping a subscription event to a DB write. `set` carries
 *  the tier+status to persist; `skip` means "do not touch the row" with
 *  a reason for logging. */
export type SubscriptionUpdate =
  | { kind: "set"; tier: Tier; status: string }
  | { kind: "skip"; reason: string };

/** Pure decision: given a Polar event type + subscription status +
 *  product id, what tier/status (if any) should we write?
 *
 *  The critical rule — extracted here so it's unit-testable away from the
 *  HTTP handler — is DO NOT silently downgrade a paying customer. If a
 *  paid-state event arrives with a product id we don't recognise
 *  (sandbox/prod mismatch, a Polar product that was renamed or recreated,
 *  monthly/annual id drift), tierFromProductId returns null. The old code
 *  fell back to "open-case", flipping a billed customer to Free with no
 *  signal. We now skip the write instead and let the caller alert.
 *
 *  `revoked` is the one event that downgrades without needing the product:
 *  payment is irrecoverably gone, so access must be removed regardless. */
export function resolveSubscriptionUpdate(
  eventType: string,
  sub: { status: string; productId: string },
): SubscriptionUpdate {
  // Payment gone → remove access immediately, product id irrelevant.
  if (eventType === "subscription.revoked") {
    return { kind: "set", tier: "open-case", status: "revoked" };
  }

  const tierInfo = tierFromProductId(sub.productId);
  if (!tierInfo) {
    return {
      kind: "skip",
      reason: `unknown productId="${sub.productId}" for ${eventType} (status="${sub.status}") — refusing to downgrade a paying customer`,
    };
  }

  if (eventType === "subscription.canceled") {
    // Canceled but still inside the paid period — keep the tier, mark status.
    return { kind: "set", tier: tierInfo.tier, status: "canceled" };
  }
  if (eventType === "subscription.past_due") {
    // Grace period after a failed invoice — keep the tier, mark status.
    return { kind: "set", tier: tierInfo.tier, status: "past_due" };
  }
  if (sub.status === "trialing") {
    return { kind: "set", tier: tierInfo.tier, status: "trialing" };
  }
  if (sub.status === "active") {
    return { kind: "set", tier: tierInfo.tier, status: "active" };
  }

  return {
    kind: "skip",
    reason: `unhandled status="${sub.status}" for ${eventType}`,
  };
}
