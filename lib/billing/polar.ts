// Polar.sh API client wrapper.
//
// We use Polar as Merchant of Record — they handle VAT, sales tax,
// payment processing, customer support refunds, and the actual
// checkout UI. Our job is:
//   1. Create checkout sessions (server-side, with userId metadata
//      so the webhook can map the payment back to a RepoJury user)
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
  tier: Exclude<Tier, "scout">;
  /** Monthly or annual billing */
  billing: "monthly" | "annual";
  /** Authenticated RepoJury user id — flows to webhook via metadata */
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

/** Resolve the Polar product id for a (tier, billing) combination
 *  from our central pricing config. Throws if the product hasn't
 *  been configured yet (defensive — prevents accidentally sending
 *  users to an empty checkout). */
function productIdFor(
  tier: Exclude<Tier, "scout">,
  billing: "monthly" | "annual",
): string {
  const config = TIER_CONFIG[tier];
  const id =
    billing === "monthly"
      ? config.polarProductIdMonthly
      : config.polarProductIdAnnual;
  if (!id) {
    throw new Error(
      `No Polar product id configured for tier="${tier}" billing="${billing}". Update lib/pricing.ts.`,
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
  for (const tier of Object.values(TIER_CONFIG)) {
    if (tier.polarProductIdMonthly === productId) {
      return { tier: tier.id, billing: "monthly" };
    }
    if (tier.polarProductIdAnnual === productId) {
      return { tier: tier.id, billing: "annual" };
    }
  }
  return null;
}
