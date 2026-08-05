"use client";

// Billing section of /account — shows the user's current plan, next
// billing date, cancellation status, and the Polar customer-portal
// button for subscription management.
//
// Three rendering modes based on tier + status:
//   1. Free (no subscription) — promotional card: "Upgrade to unlock"
//   2. Paid + active/trialing — current plan card + manage button
//   3. Paid + canceled — "Plan ends on X" warning + reactivate hint
//
// "Manage subscription" calls /api/billing/portal which returns a
// Polar-hosted URL where the user can update billing info, view
// invoices, cancel, or upgrade. We don't build any of that ourselves.

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Ban,
  ExternalLink,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
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
  // Which in-app billing action is mid-flight, and which one is awaiting an
  // inline confirm step. Both kept narrow so only one card can be "armed".
  const [busy, setBusy] = useState<null | "change" | "cancel">(null);
  const [confirm, setConfirm] = useState<null | "change" | "cancel">(null);
  // Synchronous re-entry guard. `disabled={busy !== null}` is only a visual
  // affordance — busy is set via an async setState, so a programmatic rapid
  // double-fire could slip a second POST through before the re-render. The
  // ref closes that window the instant the first handler runs.
  const inFlight = useRef(false);
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

  // tierFor defaults unknown/legacy tier values to Free instead of
  // returning undefined — so a stale DB tier can never crash this render.
  const tierConfig = tierFor(tier);
  const isPaid = tier !== "open-case";

  // The "other" paid tier the user can switch to: Plus⇄Pro. Moving to
  // full-bench (Pro) is the upgrade; moving to standing-docket is the switch.
  const otherTier: Exclude<Tier, "open-case"> =
    tier === "full-bench" ? "standing-docket" : "full-bench";
  const otherConfig = tierFor(otherTier);
  const isUpgrade = otherTier === "full-bench";

  async function changePlan() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("change");
    setFlash({ kind: "none" });
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: otherTier }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Change failed (${res.status})`);
      }
      setConfirm(null);
      setFlash({
        kind: "success",
        message: `You're now on ${otherConfig.name}. We kept your billing cycle and Polar prorates the difference automatically.`,
      });
      // Re-fetch the server component so the plan card reflects the new tier.
      router.refresh();
    } catch (err) {
      setFlash({
        kind: "error",
        message: err instanceof Error ? err.message : "Change failed",
      });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  async function setCancellation(resume: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("cancel");
    setFlash({ kind: "none" });
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resume ? { resume: true } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setConfirm(null);
      setFlash({
        kind: "success",
        message: resume
          ? "Cancellation reversed — your subscription will keep renewing."
          : "Your plan is scheduled to cancel at the end of the current period. You keep full access until then.",
      });
      router.refresh();
    } catch (err) {
      setFlash({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setBusy(null);
    }
  }

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

      {/* Change-plan card — switch between the two paid tiers in-app.
          Hidden while a cancellation is pending: the user resumes first, so
          we never switch a plan that's mid-cancellation (keeps the optimistic
          cancelAtPeriodEnd mirror coherent). */}
      {isPaid && hasSubscriptionId && !cancelAtPeriodEnd && (
        <SectionCard
          title="Change plan"
          description={
            isUpgrade
              ? `Move up to ${otherConfig.name} for more. We keep your billing cycle; Polar prorates the difference automatically.`
              : `Switch to ${otherConfig.name}. We keep your billing cycle; the change applies from your next invoice with proration.`
          }
        >
          <div className="pt-2">
            {confirm === "change" ? (
              <div className="flex flex-col gap-3">
                <p
                  className="text-sm"
                  style={{ color: TOK.textSecondary }}
                >
                  Switch from{" "}
                  <strong style={{ color: TOK.textPrimary }}>
                    {tierConfig.name}
                  </strong>{" "}
                  to{" "}
                  <strong style={{ color: TOK.textPrimary }}>
                    {otherConfig.name}
                  </strong>
                  ? Your billing cycle stays the same and proration is handled
                  for you.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={changePlan}
                    disabled={busy !== null}
                    aria-busy={busy === "change"}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: TOK.textPrimary, color: TOK.bg }}
                  >
                    {busy === "change" ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Switching…
                      </>
                    ) : (
                      <>Confirm switch to {otherConfig.name}</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm(null)}
                    disabled={busy !== null}
                    className="inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                    style={{
                      border: `1px solid ${TOK.border}`,
                      color: TOK.textSecondary,
                    }}
                  >
                    Keep current plan
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm("change")}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: TOK.textPrimary, color: TOK.bg }}
              >
                {isUpgrade ? (
                  <ArrowUpRight size={14} />
                ) : (
                  <ArrowLeftRight size={14} />
                )}
                {isUpgrade
                  ? `Upgrade to ${otherConfig.name}`
                  : `Switch to ${otherConfig.name}`}
              </button>
            )}
          </div>
        </SectionCard>
      )}

      {/* Cancel / resume card */}
      {isPaid && hasSubscriptionId && (
        <SectionCard
          title={cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription"}
          description={
            cancelAtPeriodEnd
              ? "Your plan is scheduled to cancel at the end of the current period. Resume to keep it renewing."
              : "Cancel at the end of your current billing period. You keep full access until then — no immediate downgrade."
          }
        >
          <div className="pt-2">
            {cancelAtPeriodEnd ? (
              <button
                type="button"
                onClick={() => setCancellation(true)}
                disabled={busy !== null}
                aria-busy={busy === "cancel"}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: TOK.textPrimary, color: TOK.bg }}
              >
                {busy === "cancel" ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Resuming…
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} />
                    Resume subscription
                  </>
                )}
              </button>
            ) : confirm === "cancel" ? (
              <div className="flex flex-col gap-3">
                <p
                  className="text-sm"
                  style={{ color: TOK.textSecondary }}
                >
                  Cancel{" "}
                  <strong style={{ color: TOK.textPrimary }}>
                    {tierConfig.name}
                  </strong>
                  ? You&apos;ll keep access until{" "}
                  {currentPeriodEnd
                    ? formatDate(currentPeriodEnd)
                    : "the period ends"}
                  , then move to Free.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setCancellation(false)}
                    disabled={busy !== null}
                    aria-busy={busy === "cancel"}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: TOK.rose, color: "#fff" }}
                  >
                    {busy === "cancel" ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Canceling…
                      </>
                    ) : (
                      <>Confirm cancellation</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm(null)}
                    disabled={busy !== null}
                    className="inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                    style={{
                      border: `1px solid ${TOK.border}`,
                      color: TOK.textSecondary,
                    }}
                  >
                    Never mind
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm("cancel")}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ border: `1px solid ${TOK.rose}`, color: TOK.rose }}
              >
                <Ban size={14} />
                Cancel subscription
              </button>
            )}
          </div>
        </SectionCard>
      )}

      {/* Billing & invoices — Polar customer portal */}
      {isPaid && hasSubscriptionId && (
        <SectionCard
          title="Billing & invoices"
          description="Update your payment method, download invoices, or view your full billing history in the Polar customer portal."
        >
          <div className="pt-2">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading}
              aria-busy={portalLoading}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: `1px solid ${TOK.border}`,
                color: TOK.textPrimary,
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

      {/* Upgrade card for Free users */}
      {!isPaid && (
        <SectionCard
          title="Unlock more"
          description="Upgrade to Plus to keep unlimited repos, put a grade on every pull request, and watch for regressions. Or jump straight to Pro for unlimited PR and Watch repos, SBOM export, and priority support."
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
