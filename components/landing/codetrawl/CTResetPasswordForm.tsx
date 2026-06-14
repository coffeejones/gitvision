"use client";

// CodeTrawl-themed reset-password form. Mirrors components/ResetPasswordForm
// exactly (same resetPassword call, same /login?reset=ok redirect, same
// missing-token guard) — only copy + class scoping differ. Styled by
// codetrawl.css.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { authClient } from "@/lib/authClient";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function CTResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!token) return <MissingTokenState />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "submitting") return;
    if (password.length < 8) {
      setStatus({ kind: "error", message: "Password must be at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ kind: "error", message: "Passwords don't match." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const result = await authClient.resetPassword({ newPassword: password, token: token! });
      if (result.error) {
        setStatus({
          kind: "error",
          message: result.error.message ?? "Couldn't reset password. The link may have expired.",
        });
        return;
      }
      router.push("/login?reset=ok");
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Network error. Try again." });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <div className="auth-card">
      <div className="case-tag">
        <span className="dot" /> New password
      </div>
      <h1>Set a new password.</h1>
      <p className="sub">Choose a password you don&rsquo;t use elsewhere.</p>

      {status.kind === "error" && (
        <div className="auth-err">
          <AlertCircle size={14} />
          <span>{status.message}</span>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <PasswordField
          label="New password"
          hint="At least 8 characters"
          value={password}
          onChange={setPassword}
          disabled={submitting}
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          disabled={submitting}
          autoComplete="new-password"
        />

        <button type="submit" disabled={submitting || !password || !confirmPassword} className="auth-submit">
          {submitting && <Loader2 size={14} className="auth-spin" />}
          {submitting ? "Saving…" : "Update password"}
        </button>
      </form>

      <p className="auth-switch">
        Don&rsquo;t want to reset? <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}

function PasswordField({
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
    <div className="auth-field">
      <div className="row">
        <label className="auth-label">{label}</label>
        {hint && <span className="auth-hint">{hint}</span>}
      </div>
      <input
        type="password"
        required
        minLength={8}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="auth-input"
      />
    </div>
  );
}

function MissingTokenState() {
  return (
    <div className="auth-card">
      <h1>This link is incomplete.</h1>
      <p className="sub">
        We need a valid reset token to update your password. Request a fresh
        link from the forgot-password page.
      </p>
      <Link href="/forgot-password" className="auth-submit" style={{ textDecoration: "none", marginTop: 22 }}>
        Request a new reset link
      </Link>
    </div>
  );
}
