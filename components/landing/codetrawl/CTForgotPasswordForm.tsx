"use client";

// CodeTrawl-themed forgot-password form. Mirrors components/ForgotPasswordForm
// exactly (same requestPasswordReset call, same email-enumeration-safe generic
// success state) — only copy + class scoping differ. Styled by codetrawl.css.

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { authClient } from "@/lib/authClient";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function CTForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting" });
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      if (result.error) {
        // Generic success message regardless, for email-enumeration safety.
        console.warn("[forgot-password]", result.error);
      }
      setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", message: "Network error — check your connection and try again." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="auth-card auth-card-center">
        <span className="auth-checkmark">
          <MailCheck size={24} />
        </span>
        <h1>Check your inbox.</h1>
        <p className="sub">
          If an account exists for <strong>{email.trim()}</strong>, we&rsquo;ve
          sent a password-reset link. It&rsquo;s valid for 1 hour.
        </p>
        <p className="auth-switch" style={{ marginTop: 4 }}>
          Didn&rsquo;t get it? Check spam, or{" "}
          <a role="button" tabIndex={0} onClick={() => setStatus({ kind: "idle" })} style={{ cursor: "pointer" }}>
            try a different email
          </a>
          .
        </p>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  return (
    <div className="auth-card">
      <div className="case-tag">
        <span className="dot" /> Password reset
      </div>
      <h1>Reset your password.</h1>
      <p className="sub">
        Enter the email you signed up with — we&rsquo;ll send a link to set a
        new password.
      </p>

      {status.kind === "error" && (
        <div className="auth-err">
          <AlertCircle size={14} />
          <span>{status.message}</span>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="auth-field">
          <div className="row">
            <label className="auth-label">Email</label>
          </div>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            placeholder="you@example.com"
            className="auth-input"
          />
        </div>

        <button type="submit" disabled={submitting || !email.trim()} className="auth-submit">
          {submitting && <Loader2 size={14} className="auth-spin" />}
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="auth-switch">
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
