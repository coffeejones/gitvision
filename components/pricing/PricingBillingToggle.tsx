"use client";

// Monthly / Annual billing toggle for the pricing page.
//
// Drives the price display on the tier cards via a URL search param
// (?billing=monthly|annual) so the toggle is shareable and
// bookmarkable, and so the SSR-rendered card prices match what the
// client sees on mount. We use router.replace to swap the param
// without scrolling or adding history entries.
//
// Defaults to "annual" because the discount is the conversion hook —
// users opening /pricing should see the lower per-month price first.

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  initial: "monthly" | "annual";
}

export function PricingBillingToggle({ initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState<"monthly" | "annual">(initial);
  const [, startTransition] = useTransition();

  function setMode(mode: "monthly" | "annual") {
    if (mode === billing) return;
    setBilling(mode);
    const params = new URLSearchParams(searchParams.toString());
    params.set("billing", mode);
    startTransition(() => {
      router.replace(`/pricing?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="price-toggle">
      <button
        type="button"
        className={billing === "monthly" ? "on" : undefined}
        onClick={() => setMode("monthly")}
      >
        Monthly
      </button>
      <button
        type="button"
        className={billing === "annual" ? "on" : undefined}
        onClick={() => setMode("annual")}
      >
        Annual
        <span className="tg-badge">Save 17%</span>
      </button>
    </div>
  );
}
