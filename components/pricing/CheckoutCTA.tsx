"use client";

// Client-side checkout CTA used on the pricing page. Handles three
// states:
//
//   1. Logged out  → redirect to /signup?tier=X&billing=Y (we'll
//      come back through the upgrade flow after signup completes)
//   2. Logged in + Free tier  → POST to /api/billing/checkout,
//      follow the returned Polar URL
//   3. Already on the same tier → button says "Current plan" and
//      is disabled (P5 will wire this up properly; for now we just
//      always show the checkout CTA)
//
// Loading + error states inline so the user never gets stranded.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  tierId: "open-case" | "standing-docket" | "full-bench";
  billing: "monthly" | "annual";
  isPaid: boolean;
  isRecommended: boolean;
  /** Pre-resolved auth state — undefined means we'll fetch
   *  client-side; true/false means caller knows the answer. */
  loggedIn?: boolean;
}

export function CheckoutCTA({
  tierId,
  billing,
  isPaid,
  isRecommended,
  loggedIn,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();

    // Free — straight to signup, no checkout needed
    if (!isPaid) {
      router.push("/signup?tier=open-case");
      return;
    }

    // Not logged in — send to signup with intent preserved
    if (loggedIn === false) {
      router.push(`/signup?tier=${tierId}&billing=${billing}`);
      return;
    }

    // Logged in — kick off Polar checkout
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierId, billing }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          // Session expired since page loaded — send to login
          router.push(`/login?next=/pricing?billing=${billing}`);
          return;
        }
        throw new Error(body.error ?? `Checkout failed (${res.status})`);
      }

      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(false);
    }
  }

  const isPrimary = isRecommended;
  const label = loading
    ? "Opening checkout…"
    : isPaid
      ? "Subscribe"
      : "Start free";

  return (
    <div className="tier-cta">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`btn ${isPrimary ? "btn-primary" : "btn-ghost"}`}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {label}
      </button>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
