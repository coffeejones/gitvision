"use client";

// Reset-password form (v0.76 / Phase D3).
//
// Receives a `token` query param from the email link. Posts the new
// password + token to Better Auth's resetPassword endpoint. On success
// we redirect to /login with a success flag so the login page can
// surface a "Password updated — sign in" confirmation.
//
// The token validation lives entirely on Better Auth's side (signed,
// single-use, 1h expiry). If it's invalid we surface the API error
// and let the user click "Request a new link" to start over.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";

interface Props {
  /** Token from the URL query string. We expect it to be present
   *  because the email link always includes one — if it's missing,
   *  the user manually navigated here and we show an error. */
  token: string | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function ResetPasswordForm({ token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!token) {
    return <MissingTokenState />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    if (password.length < 8) {
      setStatus({
        kind: "error",
        message: "Password must be at least 8 characters.",
      });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({
        kind: "error",
        message: "Passwords don't match.",
      });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token: token!,
      });
      if (result.error) {
        // Most likely cause: expired or already-used token. Surface
        // Better Auth's message verbatim — it's user-readable enough.
        setStatus({
          kind: "error",
          message:
            result.error.message ??
            "Couldn't reset password. The link may have expired.",
        });
        return;
      }
      // Success: bounce to /login with a flag the login page picks up
      // to show "Password updated, sign in to continue".
      router.push("/login?reset=ok");
      router.refresh();
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
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
          Set a new password
        </h1>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Choose a password you don&rsquo;t use elsewhere.
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

        <button
          type="submit"
          disabled={submitting || !password || !confirmPassword}
          className="mt-1 h-10 rounded-md text-sm font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer hover:brightness-110"
          style={{
            background: TOK.accent,
            color: TOK.accentOn,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? "Saving…" : "Update password"}
        </button>
      </form>

      <p className="text-xs text-center" style={{ color: TOK.textMuted }}>
        Don&rsquo;t want to reset?{" "}
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

function MissingTokenState() {
  return (
    <div
      className="w-full max-w-md rounded-2xl flex flex-col gap-4 p-7"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <h1
        className="text-xl font-semibold"
        style={{ color: TOK.textPrimary }}
      >
        This link is incomplete
      </h1>
      <p className="text-sm" style={{ color: TOK.textSecondary }}>
        We need a valid reset token to update your password. Request a
        fresh link from the forgot-password page.
      </p>
      <Link
        href="/forgot-password"
        className="mt-2 h-10 px-4 rounded-md text-sm font-medium transition flex items-center justify-center cursor-pointer hover:brightness-110"
        style={{
          background: TOK.accent,
          color: TOK.accentOn,
        }}
      >
        Request a new reset link
      </Link>
    </div>
  );
}
