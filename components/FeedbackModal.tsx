"use client";

// In-app feedback modal (v0.74).
//
// Why a custom modal instead of mailto: or a GitHub-issues link:
//   - Most casual users won't open a GitHub account just to flag a bug.
//     We lose 80% of feedback at the friction step.
//   - Auto-includes context (page URL, session id, user agent) that the
//     user wouldn't think to copy when filing manually.
//   - Stays in-app — no tab switching, no losing the session they were
//     looking at when they noticed something.
//
// Submission flow:
//   form → POST /api/feedback → success | error state → close
//
// Privacy note: the email field is OPTIONAL and clearly labelled. We
// don't track / fingerprint users; everything we send is what they
// typed plus the page URL they were on. The /legal page documents
// this so it's not a surprise.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Send, X, CheckCircle2, AlertCircle } from "lucide-react";
import { TOK } from "@/lib/theme";
// Import from the browser-safe surface — lib/feedback.ts itself
// uses node:fs/path and would drag those into the client bundle.
import {
  FEEDBACK_TYPES,
  FEEDBACK_LIMITS,
  type FeedbackType,
} from "@/lib/feedbackTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Session id to auto-include when submitting from inside a
   *  session — lets the maintainer load the same session to
   *  investigate. Undefined when submitting from the marketing page. */
  sessionId?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; id: string }
  | { kind: "error"; message: string };

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug — something's broken or behaving weirdly",
  feature: "Feature request — something I wish GitVision did",
  general: "General feedback — anything else",
  question: "Question — I'm stuck and need help",
};

export function FeedbackModal({ open, onClose, sessionId }: Props) {
  const [type, setType] = useState<FeedbackType>("general");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Reset state on close so re-opening doesn't show the previous
  // submission's success message.
  useEffect(() => {
    if (!open) return;
    setType("general");
    setDescription("");
    setEmail("");
    setStatus({ kind: "idle" });
  }, [open]);

  // Esc closes — same affordance as ShareCardModal so users build
  // the muscle memory.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // SSR-safe: createPortal needs document.body, only available client-side.
  // open=true only happens after user click, so window is defined by then.
  if (typeof window === "undefined") return null;

  const submitting = status.kind === "submitting";
  const isSuccess = status.kind === "success";
  const canSubmit =
    description.trim().length > 0 &&
    description.length <= FEEDBACK_LIMITS.description &&
    !submitting &&
    !isSuccess;

  async function submit() {
    if (!canSubmit) return;
    setStatus({ kind: "submitting" });
    try {
      const pageUrl =
        typeof window !== "undefined" ? window.location.href : undefined;
      const userAgent =
        typeof navigator !== "undefined" ? navigator.userAgent : undefined;
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          description: description.trim(),
          email: email.trim() || undefined,
          pageUrl,
          userAgent,
          sessionId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        const message =
          data.message ??
          (res.status === 429
            ? "Too many submissions in the last hour. Try again later."
            : "Something went wrong on our end. Try again in a moment.");
        setStatus({ kind: "error", message });
        return;
      }
      setStatus({ kind: "success", id: data.id ?? "" });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error — check your connection and try again.",
      });
    }
  }

  // Render via portal at document.body so the modal escapes any
  // ancestor that creates a containing block for fixed-position
  // descendants (notably MarketingNav's `backdrop-filter: blur` —
  // without the portal, `fixed inset-0` would be relative to the
  // nav bar, not the viewport, and the modal renders only inside
  // the nav's bounds).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        // Modal centered. maxHeight caps it at 90vh; header stays
        // pinned (no scroll), body scrolls internally if form is
        // taller than what fits.
        className="relative rounded-2xl shadow-2xl flex flex-col w-full overflow-hidden"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
          maxWidth: 520,
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${TOK.border}` }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: TOK.textPrimary }}
          >
            Send feedback
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-md transition cursor-pointer"
            style={{ color: TOK.textMuted }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = TOK.surfaceElevated;
              e.currentTarget.style.color = TOK.textSecondary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = TOK.textMuted;
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — switches between form and success state. Wrapper
         *  has flex-1 + min-h-0 + overflow-y-auto so it scrolls
         *  internally when the form is taller than what fits inside
         *  the modal's 90vh max. Header above stays pinned. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {isSuccess ? (
          <SuccessState onClose={onClose} />
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            {/* Type */}
            <Field label="Type">
              <div className="flex flex-col gap-1.5">
                {FEEDBACK_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    style={{ color: TOK.textSecondary }}
                  >
                    <input
                      type="radio"
                      name="feedback-type"
                      value={t}
                      checked={type === t}
                      onChange={() => setType(t)}
                      disabled={submitting}
                    />
                    {TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </Field>

            {/* Description */}
            <Field
              label="Description"
              hint={`${description.length}/${FEEDBACK_LIMITS.description}`}
            >
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                rows={6}
                placeholder="What happened? What did you expect to see? Be as specific as helps you."
                className="w-full rounded-md px-3 py-2 text-sm outline-none resize-y"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textPrimary,
                  minHeight: 120,
                }}
                maxLength={FEEDBACK_LIMITS.description + 100}
              />
            </Field>

            {/* Email — clearly optional */}
            <Field label="Email" hint="Optional — only if you want a reply">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="you@example.com"
                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                style={{
                  background: TOK.surfaceElevated,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textPrimary,
                }}
                maxLength={FEEDBACK_LIMITS.email}
              />
            </Field>

            {/* Auto-included context note */}
            <p className="text-[11px]" style={{ color: TOK.textMuted }}>
              We auto-include the page you&apos;re on
              {sessionId ? " and the session id" : ""} so we can reproduce
              what you saw. No tracking beyond that.
            </p>

            {/* Error banner */}
            {status.kind === "error" && (
              <div
                className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
                style={{
                  background: `${TOK.rose}1a`,
                  border: `1px solid ${TOK.rose}55`,
                  color: TOK.rose,
                }}
              >
                <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{status.message}</span>
              </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={submitting}
                className="h-8 px-3 rounded-md text-xs transition cursor-pointer disabled:opacity-50"
                style={{
                  background: TOK.surface,
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textSecondary,
                }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="h-8 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-40 cursor-pointer hover:brightness-110"
                style={{
                  background: TOK.accent,
                  color: TOK.accentOn,
                }}
              >
                <Send size={12} />
                {submitting ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SuccessState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-8 items-center text-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{
          background: TOK.accentSoft,
          color: TOK.accent,
        }}
      >
        <CheckCircle2 size={28} />
      </div>
      <div className="flex flex-col gap-1">
        <h3
          className="text-base font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          Thanks — we got it.
        </h3>
        <p className="text-sm" style={{ color: TOK.textSecondary }}>
          If you left an email and we have something to ask, we&apos;ll
          reach out. Otherwise consider it logged.
        </p>
      </div>
      <button
        onClick={onClose}
        className="mt-2 h-8 px-4 rounded-md text-xs font-medium transition cursor-pointer hover:brightness-110"
        style={{
          background: TOK.accent,
          color: TOK.accentOn,
        }}
      >
        Close
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: TOK.textMuted }}
        >
          {label}
        </label>
        {hint && (
          <span className="text-[11px]" style={{ color: TOK.textMuted }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
