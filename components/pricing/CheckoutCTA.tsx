"use client";

// Client-side checkout CTA used on the pricing page. Handles three
// states:
//
//   1. Logged out  → redirect to /signup?tier=X&billing=Y (we'll
//      come back through the upgrade flow after signup completes)
//   2. Logged in + Open case tier  → POST to /api/billing/checkout,
//      follow the returned Polar URL
//   3. Already on the same tier → button says "Current plan" and
//      is disabled (P5 will wire this up properly; for now we just
//      always show the checkout CTA)
//
// Loading + error states inline so the user never gets stranded.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TOK } from "@/lib/theme";

interface Props {
  tierId: "open-case" | "standing-docket" | "full-bench";
  billing: "monthly" | "annual";
  isPaid: boolean;
  isRecommended: boolean;
  /** Pre-resolved auth state — undefined means we'll fetch
   *  client-side; true/false means caller knows the answer. */
  loggedIn?: boolean;
  trialDays: number;
}

export function CheckoutCTA({
  tierId,
  billing,
  isPaid,
  isRecommended,
  loggedIn,
  trialDays,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();

    // Open case — straight to signup, no checkout needed
    if (!isPaid) {
      router.push("/signup?tier=scout");
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
      ? `Start ${trialDays}-day trial`
      : "Start free";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center justify-center h-11 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
        style={{
          background: isPrimary
            ? TOK.textPrimary
            : "rgba(255, 255, 255, 0.04)",
          color: isPrimary ? TOK.bg : TOK.textPrimary,
          border: isPrimary
            ? "none"
            : `1px solid rgba(255, 255, 255, 0.1)`,
        }}
      >
        {label}
      </button>
      {error && (
        <p
          className="text-xs"
          style={{ color: TOK.rose }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
