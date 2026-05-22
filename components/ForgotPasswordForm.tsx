"use client";

// Forgot-password form (v0.76 / Phase D3).
//
// One field (email) → POST through Better Auth's forgetPassword
// endpoint → Better Auth fires our sendResetPassword callback →
// Resend delivers the email.
//
// UX note: regardless of whether the email is registered, we show
// the same success state ("If an account exists, we've sent a link").
// Email enumeration would otherwise let attackers test which addresses
// are signed up. Better Auth handles this server-side too, but mirror-
// ing the message client-side keeps the leak from happening even on
// error responses.

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting" });

    try {
      // Better Auth's requestPasswordReset endpoint. redirectTo is the
      // URL the reset link should land on — Better Auth signs the
      // token and appends it as a ?token=... query param.
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      if (result.error) {
        // We still show the generic "if an account exists..." message
        // for privacy. Log the real error to console for debugging.
        console.warn("[forgot-password]", result.error);
      }
      setStatus({ kind: "sent" });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error — check your connection and try again.",
      });
    }
  }

  if (status.kind === "sent") {
    return (
      <div
        className="w-full max-w-md rounded-2xl flex flex-col gap-4 p-7 items-center text-center"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
        }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: TOK.accentSoft,
            color: TOK.accent,
          }}
        >
          <MailCheck size={28} />
        </div>
        <h1
          className="text-xl font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          Check your inbox
        </h1>
        <p
          className="text-sm leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          If an account exists for <strong>{email.trim()}</strong>, we&rsquo;ve
          sent a password-reset link. It&rsquo;s valid for 1 hour.
        </p>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Didn&rsquo;t get it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => setStatus({ kind: "idle" })}
            className="font-medium hover:underline"
            style={{
              color: TOK.accent,
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            try a different email
          </button>
          .
        </p>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  return (
    <div
      className="w-full max-w-md rounded-2xl flex flex-col gap-5 p-7"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <header className="flex flex-col gap-1">
        <h1
          className="text-xl font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          Reset your password
        </h1>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Enter the email you signed up with. We&rsquo;ll send a link to
          set a new password.
        </p>
      </header>

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

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[11px] uppercase tracking-[0.08em] font-semibold"
            style={{ color: TOK.textMuted }}
          >
            Email
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            placeholder="you@example.com"
            className="w-full h-9 rounded-md px-3 text-sm outline-none"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textPrimary,
            }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="mt-1 h-10 rounded-md text-sm font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer hover:brightness-110"
          style={{
            background: TOK.accent,
            color: TOK.accentOn,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="text-xs text-center" style={{ color: TOK.textMuted }}>
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium hover:underline"
          style={{ color: TOK.accent }}
        >
          Back to log in
        </Link>
      </p>
    </div>
  );
}
