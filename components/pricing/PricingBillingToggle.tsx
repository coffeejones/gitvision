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
import { TOK } from "@/lib/theme";

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
    <div
      className="inline-flex items-center p-1 rounded-lg"
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: `1px solid ${TOK.border}`,
      }}
    >
      <ToggleButton
        active={billing === "monthly"}
        onClick={() => setMode("monthly")}
        label="Monthly"
      />
      <ToggleButton
        active={billing === "annual"}
        onClick={() => setMode("annual")}
        label="Annual"
        badge="Save 17%"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-4 h-9 rounded-md text-sm transition"
      style={{
        background: active ? TOK.textPrimary : "transparent",
        color: active ? TOK.bg : TOK.textSecondary,
        fontWeight: active ? 500 : 400,
      }}
    >
      <span>{label}</span>
      {badge && (
        <span
          className="text-[10px] uppercase tracking-[0.12em] font-medium px-1.5 py-0.5 rounded"
          style={{
            background: active ? TOK.bg : TOK.accentSoft,
            color: active ? TOK.accent : TOK.accent,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
