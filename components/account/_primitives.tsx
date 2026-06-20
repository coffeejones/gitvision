// Shared low-level primitives used by every account-section panel
// (v0.76 / Phase D4).
//
// All pure presentational components — no state, no effects. State
// (edit-mode toggles, flash banner kind, submission loading) lives
// in the section panels that own it. Keeping primitives stateless
// means we can re-use them anywhere without prop coupling.
//
// Naming:
//   Row              — one settings row (label + description on left,
//                      value + action on right, vertically centered
//                      via CSS grid).
//   RowAction        — the ghost-style button that sits at the right
//                      edge of a Row.
//   SectionCard      — the rounded container that wraps a section's
//                      rows. Title + description header on top.
//   Badge            — small status pill (Verified, Not verified).
//   ComingSoonBadge  — disabled-style pill for placeholder rows.
//   FlashBanner      — top-of-panel success / error toast.
//   PasswordField    — labelled password input used by the inline
//                      Set/Change Password form.

"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { TOK } from "@/components/account/theme";

// ─── Row ────────────────────────────────────────────────────────────

export function Row({
  label,
  description,
  value,
  action,
  comingSoon,
  expanded,
}: {
  label: string;
  description?: string;
  value?: React.ReactNode;
  action?: React.ReactNode;
  comingSoon?: boolean;
  /** Optional element rendered below the row's main line — used by
   *  PasswordRow / NameRow for inline edit forms. */
  expanded?: React.ReactNode;
}) {
  return (
    <div
      // py-5 per row. first:pt-2 / last:pb-2 trim leading/trailing
      // gaps so the top row doesn't fight the section header's
      // bottom margin.
      //
      // CSS grid (not flex) for the main row so the right column is
      // properly centered against the taller left column. Flex's
      // items-center technically does the same, but with a muted
      // description on the left the visual perception was top-aligned.
      // Grid + items-center forces the right side to the geometric
      // vertical centre of the left block.
      className="py-5 first:pt-2 last:pb-2"
      style={{
        borderTop: `1px solid ${TOK.border}`,
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 sm:items-center">
        <div className="flex flex-col gap-1 min-w-0">
          <span
            className="text-sm font-medium"
            style={{
              color: comingSoon ? TOK.textMuted : TOK.textPrimary,
            }}
          >
            {label}
          </span>
          {description && (
            <span
              className="text-xs leading-relaxed"
              style={{ color: TOK.textMuted }}
            >
              {description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {value !== undefined && (
            <span
              className="text-sm"
              style={{
                color: comingSoon ? TOK.textMuted : TOK.textSecondary,
              }}
            >
              {value}
            </span>
          )}
          {action}
        </div>
      </div>
      {expanded}
    </div>
  );
}

// ─── RowAction ──────────────────────────────────────────────────────

export function RowAction({
  onClick,
  disabled,
  children,
  tone = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs font-medium px-2.5 py-1 rounded transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 inline-flex items-center gap-1"
      style={{
        color: tone === "danger" ? TOK.rose : TOK.textSecondary,
        border: `1px solid ${TOK.border}`,
      }}
    >
      {children}
    </button>
  );
}

// ─── SectionCard ────────────────────────────────────────────────────

export function SectionCard({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl p-6 sm:p-7"
      style={{
        background: TOK.surface,
        border: `1px solid ${tone === "danger" ? `${TOK.rose}33` : TOK.border}`,
      }}
    >
      <header className="flex flex-col gap-1">
        <h2
          className="text-base font-semibold"
          style={{
            color: tone === "danger" ? TOK.rose : TOK.textPrimary,
          }}
        >
          {title}
        </h2>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          {description}
        </p>
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────

export function Badge({
  tone,
  icon,
  label,
}: {
  tone: "accent" | "amber";
  icon: React.ReactNode;
  label: string;
}) {
  const color = tone === "accent" ? TOK.accent : TOK.amber;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded"
      style={{
        background: `${color}1a`,
        color,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

// ─── ComingSoonBadge ────────────────────────────────────────────────

export function ComingSoonBadge() {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.08em] font-semibold px-2 py-0.5 rounded"
      style={{
        background: TOK.surfaceElevated,
        color: TOK.textMuted,
        border: `1px solid ${TOK.border}`,
      }}
    >
      Coming soon
    </span>
  );
}

// ─── FlashBanner ────────────────────────────────────────────────────

export type Flash =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function FlashBanner({
  flash,
  onClose,
}: {
  flash: Flash;
  onClose: () => void;
}) {
  if (flash.kind === "none") return null;
  const isSuccess = flash.kind === "success";
  const color = isSuccess ? TOK.accent : TOK.rose;
  return (
    <div
      className="flex items-start gap-2 rounded-md px-3 py-2 text-xs mb-4"
      style={{
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        color,
      }}
      // Errors are announced assertively so a screen-reader user hears a
      // failure promptly; success stays polite.
      role={isSuccess ? "status" : "alert"}
    >
      {isSuccess ? (
        <CheckCircle2 size={14} style={{ marginTop: 1, flexShrink: 0 }} />
      ) : (
        <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
      )}
      <span className="flex-1">{flash.message}</span>
      <button
        onClick={onClose}
        className="opacity-70 hover:opacity-100 cursor-pointer"
        type="button"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── PasswordField ──────────────────────────────────────────────────

export function PasswordField({
  label,
  hint,
  value,
  onChange,
  disabled,
  autoComplete,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  autoComplete: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label
          className="text-[10px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: TOK.textMuted }}
        >
          {label}
        </label>
        {hint && (
          <span className="text-[10px]" style={{ color: TOK.textMuted }}>
            {hint}
          </span>
        )}
      </div>
      <input
        type="password"
        required
        minLength={8}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-9 rounded-md px-3 text-sm outline-none"
        style={{
          background: TOK.surfaceElevated,
          border: `1px solid ${TOK.border}`,
          color: TOK.textPrimary,
        }}
      />
    </div>
  );
}
