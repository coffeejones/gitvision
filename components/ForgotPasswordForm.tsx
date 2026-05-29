"use client";

// Forgot-password form (v0.76 / Phase D3; restyled forensic-dossier
// in Phase M).
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
//
// Styling: `.rj auth-*` classes (shared with AuthForm) so the page
// matches the records-office aesthetic.

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
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
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            margin: "0 auto 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(16,185,129,.1)",
            color: "var(--cleared)",
          }}
        >
          <MailCheck size={26} />
        </div>
        <h1>Check your inbox</h1>
        <p className="sub">
          If an account exists for <strong>{email.trim()}</strong>, we&rsquo;ve
          sent a password-reset link. It&rsquo;s valid for 1 hour.
        </p>
        <p className="auth-switch" style={{ marginTop: 0 }}>
          Didn&rsquo;t get it? Check spam, or{" "}
          <a
            role="button"
            tabIndex={0}
            onClick={() => setStatus({ kind: "idle" })}
            style={{ cursor: "pointer" }}
          >
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
        <span className="dot" /> Case recovery
      </div>
      <h1>Reset your password</h1>
      <p className="sub">
        Enter the email you signed up with. We&rsquo;ll send a link to set a
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

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="auth-submit"
        >
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
