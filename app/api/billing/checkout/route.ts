// POST /api/billing/checkout — server endpoint that creates a Polar
// checkout session for the authenticated user and returns the URL
// to redirect to. The pricing page calls this, then redirects the
// browser to checkout.url.
//
// Auth-gated: only logged-in users can hit this. Anonymous traffic
// gets a 401 — they're directed to /signup first. This means the
// /pricing page CTAs need different handling for logged-out
// (redirect to /signup?next=/pricing) vs logged-in (POST here).

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createCheckoutSession } from "@/lib/billing/polar";
import type { Tier } from "@/components/TierIcon";

const VALID_TIERS: Tier[] = ["standing-docket", "full-bench"];
const VALID_BILLING = ["monthly", "annual"] as const;

export async function POST(req: Request) {
  // Verify the user is authenticated
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401 },
    );
  }

  // Parse + validate the request body
  let body: { tier?: string; billing?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const tier = body.tier;
  const billing = body.billing;

  if (!tier || !VALID_TIERS.includes(tier as Tier)) {
    return NextResponse.json(
      {
        error: `Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (
    !billing ||
    !VALID_BILLING.includes(billing as (typeof VALID_BILLING)[number])
  ) {
    return NextResponse.json(
      {
        error: `Invalid billing. Must be one of: ${VALID_BILLING.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Build the success URL — Polar redirects here after successful
  // checkout. We send the user to /account/billing where they can
  // see their new plan + confirmation message.
  const protocol = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "codetrawl.com";
  const successUrl = `${protocol}://${host}/account/billing?upgraded=1`;

  try {
    const checkout = await createCheckoutSession({
      tier: tier as Exclude<Tier, "open-case">,
      billing: billing as "monthly" | "annual",
      userId: session.user.id,
      userEmail: session.user.email,
      successUrl,
    });

    return NextResponse.json({
      url: checkout.url,
      checkoutId: checkout.checkoutId,
    });
  } catch (err) {
    console.error("[billing/checkout] Polar API error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to create checkout session",
      },
      { status: 500 },
    );
  }
}
