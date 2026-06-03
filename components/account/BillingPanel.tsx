"use client";

// Billing section of /account — shows the user's current plan, next
// billing date, cancellation status, and the Polar customer-portal
// button for subscription management.
//
// Three rendering modes based on tier + status:
//   1. Open case (no subscription) — promotional card: "Upgrade to unlock"
//   2. Paid + active/trialing — current plan card + manage button
//   3. Paid + canceled — "Plan ends on X" warning + reactivate hint
//
// "Manage subscription" calls /api/billing/portal which returns a
// Polar-hosted URL where the user can update billing info, view
// invoices, cancel, or upgrade. We don't build any of that ourselves.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import { TOK } from "@/components/account/theme";
import { TierIcon, type Tier } from "@/components/TierIcon";
import { tierFor, formatPrice } from "@/lib/pricing";
import {
  FlashBanner,
  SectionCard,
  type Flash,
} from "@/components/account/_primitives";

interface Props {
  tier: Tier;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  hasSubscriptionId: boolean;
}

export function BillingPanel({
  tier,
  subscriptionStatus,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasSubscriptionId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [portalLoading, setPortalLoading] = useState(false);
  const [flash, setFlash] = useState<Flash>(() => {
    if (searchParams.get("upgraded") === "1") {
      return {
        kind: "success",
        message:
          "Welcome to your new plan. Subscription is active — start exploring the unlocked features.",
      };
    }
    return { kind: "none" };
  });

  // tierFor defaults unknown/legacy tier values to Open case instead of
  // returning undefined — so a stale DB tier can never crash this render.
  const tierConfig = tierFor(tier);
  const isPaid = tier !== "open-case";

  async function openPortal() {
    setPortalLoading(true);
    setFlash({ kind: "none" });
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Portal failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setFlash({
        kind: "error",
        message: err instanceof Error ? err.message : "Portal failed",
      });
      setPortalLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FlashBanner
        flash={flash}
        onClose={() => {
          setFlash({ kind: "none" });
          // Strip the ?upgraded=1 from URL so it doesn't re-trigger on
          // back-navigation
          const params = new URLSearchParams(searchParams.toString());
          params.delete("upgraded");
          router.replace(
            `/account/billing${params.toString() ? `?${params.toString()}` : ""}`,
            { scroll: false },
          );
        }}
      />

      {/* Current plan card */}
      <SectionCard
        title="Current plan"
        description="Your active subscription tier and billing status."
      >
        <div className="flex items-start gap-4 pt-2">
          <div
            className="rounded-lg p-3 flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
              border: `1px solid ${TOK.border}`,
            }}
          >
            <TierIcon tier={tier} size={32} />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3
                className="text-xl font-semibold tracking-tight"
                style={{
                  color: TOK.textPrimary,
                  letterSpacing: "-0.015em",
                }}
              >
                {tierConfig.name}
              </h3>
              <StatusBadge
                status={subscriptionStatus}
                cancelAtPeriodEnd={cancelAtPeriodEnd}
                isPaid={isPaid}
              />
            </div>
            <p className="text-sm" style={{ color: TOK.textSecondary }}>
              {tierConfig.tagline}
            </p>
            {isPaid && (
              <p
                className="text-xs mt-2"
                style={{ color: TOK.textMuted }}
              >
                {formatPrice(tierConfig.monthlyPriceUsd)}/mo or{" "}
                {formatPrice(tierConfig.annualPriceUsd)}/year
              </p>
            )}
          </div>
        </div>

        {/* Subscription details */}
        {isPaid && currentPeriodEnd && (
          <div
            className="mt-4 pt-4 flex flex-col gap-2"
            style={{ borderTop: `1px solid ${TOK.border}` }}
          >
            <DetailRow
              label={
                cancelAtPeriodEnd
                  ? "Plan ends on"
                  : subscriptionStatus === "trialing"
                    ? "Trial ends on"
                    : "Next billing date"
              }
              value={formatDate(currentPeriodEnd)}
            />
          </div>
        )}
      </SectionCard>

      {/* Actions card */}
      {isPaid && hasSubscriptionId && (
        <SectionCard
          title="Manage subscription"
          description="Update billing info, view invoices, change plan, or cancel — all via your Polar customer portal."
        >
          <div className="pt-2">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: TOK.textPrimary,
                color: TOK.bg,
              }}
            >
              {portalLoading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Opening portal…
                </>
              ) : (
                <>
                  Open customer portal
                  <ExternalLink size={14} />
                </>
              )}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Upgrade card for Open case users */}
      {!isPaid && (
        <SectionCard
          title="Unlock more"
          description="Upgrade to Standing docket for unlimited sessions, AI Insights, and the PR-bot. Or jump straight to Full bench for team workspaces and priority support."
        >
          <div className="pt-2">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90"
              style={{
                background: TOK.textPrimary,
                color: TOK.bg,
              }}
            >
              See plans
              <ArrowRight size={14} />
            </Link>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  cancelAtPeriodEnd,
  isPaid,
}: {
  status: string | null;
  cancelAtPeriodEnd: boolean;
  isPaid: boolean;
}) {
  if (!isPaid) return null;

  let label: string;
  let color: string;
  let bg: string;

  if (cancelAtPeriodEnd) {
    label = "Canceling";
    color = TOK.amber;
    bg = TOK.amberSoft;
  } else if (status === "trialing") {
    label = "Trial";
    color = TOK.accent;
    bg = TOK.accentSoft;
  } else if (status === "active") {
    label = "Active";
    color = TOK.accent;
    bg = TOK.accentSoft;
  } else if (status === "past_due") {
    label = "Past due";
    color = TOK.amber;
    bg = TOK.amberSoft;
  } else if (status === "canceled") {
    label = "Canceled";
    color = TOK.rose;
    bg = TOK.roseSoft;
  } else if (status === "revoked") {
    label = "Revoked";
    color = TOK.rose;
    bg = TOK.roseSoft;
  } else {
    return null;
  }

  return (
    <span
      className="text-[10px] uppercase tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span style={{ color: TOK.textMuted }}>{label}</span>
      <span
        className="tabular-nums font-medium"
        style={{ color: TOK.textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
