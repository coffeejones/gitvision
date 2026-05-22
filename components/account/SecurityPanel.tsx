"use client";

// Security settings — password + email verification + active
// sessions placeholder (v0.76 / D4).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, Mail, MailCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";
import { setPasswordAction } from "@/app/account/actions";
import {
  Badge,
  ComingSoonBadge,
  FlashBanner,
  PasswordField,
  Row,
  RowAction,
  SectionCard,
  type Flash,
} from "@/components/account/_primitives";
import type { AccountUser } from "@/lib/userFromSession";

interface Props {
  user: AccountUser;
  hasPassword: boolean;
}

export function SecurityPanel({ user, hasPassword }: Props) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>({ kind: "none" });

  function showSuccess(message: string) {
    setFlash({ kind: "success", message });
    setTimeout(() => setFlash({ kind: "none" }), 4000);
    router.refresh();
  }
  function showError(message: string) {
    setFlash({ kind: "error", message });
  }

  return (
    <>
      <FlashBanner flash={flash} onClose={() => setFlash({ kind: "none" })} />
      <SectionCard
        title="Security"
        description="Manage how you sign in and protect your account."
      >
        <PasswordRow
          hasPassword={hasPassword}
          onSuccess={showSuccess}
          onError={showError}
        />
        <EmailVerificationRow
          user={user}
          onSuccess={showSuccess}
          onError={showError}
        />
        <Row
          label="Active sessions"
          description="See where you're signed in and sign out remotely."
          value={<ComingSoonBadge />}
          comingSoon
        />
      </SectionCard>
    </>
  );
}

function PasswordRow({
  hasPassword,
  onSuccess,
  onError,
}: {
  hasPassword: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setEditing(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (newPassword.length < 8) {
      onError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      onError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      if (hasPassword) {
        const result = await authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        });
        if (result.error) {
          onError(result.error.message ?? "Couldn't change password.");
          return;
        }
        onSuccess("Password changed.");
      } else {
        const result = await setPasswordAction(newPassword);
        if (!result.ok) {
          onError(result.error);
          return;
        }
        onSuccess("Password set. You can now log in with email + password.");
      }
      reset();
    } catch {
      onError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Row
      label="Password"
      description={
        hasPassword
          ? "Used to sign in with email and password."
          : "You signed in via GitHub. Set a password to also log in with email."
      }
      value={
        !editing &&
        (hasPassword ? (
          "••••••••"
        ) : (
          <span style={{ color: TOK.textMuted }}>Not set</span>
        ))
      }
      action={
        !editing && (
          <RowAction onClick={() => setEditing(true)}>
            <KeyRound size={11} />
            {hasPassword ? "Change" : "Set password"}
          </RowAction>
        )
      }
      expanded={
        editing && (
          <form
            onSubmit={handleSave}
            className="flex flex-col gap-3 mt-3 p-4 rounded-md"
            style={{
              background: TOK.bg,
              border: `1px solid ${TOK.border}`,
            }}
          >
            {hasPassword && (
              <PasswordField
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                disabled={submitting}
                autoComplete="current-password"
              />
            )}
            <PasswordField
              label="New password"
              hint="At least 8 characters"
              value={newPassword}
              onChange={setNewPassword}
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
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={reset}
                disabled={submitting}
                className="h-9 px-3 rounded-md text-xs transition cursor-pointer disabled:opacity-50"
                style={{
                  background: "transparent",
                  border: `1px solid ${TOK.border}`,
                  color: TOK.textSecondary,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !newPassword || !confirmPassword}
                className="h-9 px-4 rounded-md text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-40 cursor-pointer hover:brightness-110"
                style={{
                  background: TOK.accent,
                  color: TOK.accentOn,
                }}
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                {submitting
                  ? "Saving…"
                  : hasPassword
                    ? "Change password"
                    : "Set password"}
              </button>
            </div>
          </form>
        )
      }
    />
  );
}

function EmailVerificationRow({
  user,
  onSuccess,
  onError,
}: {
  user: AccountUser;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [resending, setResending] = useState(false);

  async function handleResend() {
    if (resending) return;
    setResending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: "/account/security?verified=1",
      });
      if (result.error) {
        onError(
          result.error.message ?? "Couldn't send the verification email."
        );
        return;
      }
      onSuccess("Verification email sent. Check your inbox (and spam folder).");
    } catch {
      onError("Network error. Try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <Row
      label="Email verification"
      description={
        user.emailVerified
          ? "Your email address is confirmed."
          : "Confirm your email so we can reach you for password reset and important account notices."
      }
      value={
        user.emailVerified ? (
          <Badge
            tone="accent"
            icon={<MailCheck size={10} />}
            label="Verified"
          />
        ) : (
          <Badge tone="amber" icon={<Mail size={10} />} label="Not verified" />
        )
      }
      action={
        !user.emailVerified && (
          <RowAction onClick={handleResend} disabled={resending}>
            {resending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Mail size={11} />
            )}
            {resending ? "Sending…" : "Resend email"}
          </RowAction>
        )
      }
    />
  );
}
