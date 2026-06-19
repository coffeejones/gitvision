// Tier-resolution coverage for the Polar billing webhook — the most
// financially critical path in the app, previously untested. We test the
// pure decision functions (no HTTP, no DB) extracted into lib/billing/polar.ts.

import { describe, it, expect } from "vitest";
import {
  resolveSubscriptionUpdate,
  tierFromProductId,
} from "../billing/polar";
import { TIER_CONFIG } from "../pricing";

const PLUS_MONTHLY = TIER_CONFIG["standing-docket"].polarProductIdMonthly;
const PLUS_ANNUAL = TIER_CONFIG["standing-docket"].polarProductIdAnnual;
const PRO_MONTHLY = TIER_CONFIG["full-bench"].polarProductIdMonthly;

describe("tierFromProductId", () => {
  it("maps known monthly + annual product ids to their tier", () => {
    expect(tierFromProductId(PLUS_MONTHLY)).toEqual({
      tier: "standing-docket",
      billing: "monthly",
    });
    expect(tierFromProductId(PLUS_ANNUAL)).toEqual({
      tier: "standing-docket",
      billing: "annual",
    });
    expect(tierFromProductId(PRO_MONTHLY)).toEqual({
      tier: "full-bench",
      billing: "monthly",
    });
  });

  it("returns null for an unknown product id", () => {
    expect(tierFromProductId("not-a-real-product")).toBeNull();
  });
});

describe("resolveSubscriptionUpdate", () => {
  it("flips an active subscription to its paid tier", () => {
    expect(
      resolveSubscriptionUpdate("subscription.active", {
        status: "active",
        productId: PLUS_MONTHLY,
      }),
    ).toEqual({ kind: "set", tier: "standing-docket", status: "active" });
  });

  it("treats subscription.updated/active the same way (Pro)", () => {
    expect(
      resolveSubscriptionUpdate("subscription.updated", {
        status: "active",
        productId: PRO_MONTHLY,
      }),
    ).toEqual({ kind: "set", tier: "full-bench", status: "active" });
  });

  it("revokes to Free regardless of product id (payment gone)", () => {
    expect(
      resolveSubscriptionUpdate("subscription.revoked", {
        status: "active",
        productId: "anything-at-all",
      }),
    ).toEqual({ kind: "set", tier: "open-case", status: "revoked" });
  });

  it("keeps the paid tier on cancel (still inside the period)", () => {
    expect(
      resolveSubscriptionUpdate("subscription.canceled", {
        status: "active",
        productId: PLUS_MONTHLY,
      }),
    ).toEqual({ kind: "set", tier: "standing-docket", status: "canceled" });
  });

  it("keeps the paid tier while past_due (grace period)", () => {
    expect(
      resolveSubscriptionUpdate("subscription.past_due", {
        status: "past_due",
        productId: PLUS_MONTHLY,
      }),
    ).toEqual({ kind: "set", tier: "standing-docket", status: "past_due" });
  });

  it("grants the tier during a trial", () => {
    expect(
      resolveSubscriptionUpdate("subscription.created", {
        status: "trialing",
        productId: PLUS_ANNUAL,
      }),
    ).toEqual({ kind: "set", tier: "standing-docket", status: "trialing" });
  });

  // The core regression guard: a paid-state event with an unrecognised
  // product id must NOT downgrade a paying customer to Free.
  it("SKIPS an active event with an unknown product id (no silent downgrade)", () => {
    const r = resolveSubscriptionUpdate("subscription.active", {
      status: "active",
      productId: "sandbox-or-renamed-product-uuid",
    });
    expect(r.kind).toBe("skip");
  });

  it("SKIPS a cancel with an unknown product id rather than wiping the tier", () => {
    const r = resolveSubscriptionUpdate("subscription.canceled", {
      status: "active",
      productId: "unknown",
    });
    expect(r.kind).toBe("skip");
  });

  it("skips an unhandled status on a known product", () => {
    const r = resolveSubscriptionUpdate("subscription.updated", {
      status: "incomplete",
      productId: PLUS_MONTHLY,
    });
    expect(r.kind).toBe("skip");
  });
});
