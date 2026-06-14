// /forgot-password — request a password reset link (v0.76 / D4 polish).
//
// Server Component. Already-logged-in callers don't need this flow,
// but unlike /login + /signup we DON'T redirect them away — they may
// be helping a teammate reset, or testing the flow. The form just
// works either way.
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { CTForgotPasswordForm } from "@/components/landing/codetrawl/CTForgotPasswordForm";
import { CTAuthShell } from "@/components/landing/codetrawl/CTAuthShell";

export const metadata = {
  title: "Reset your password — CodeTrawl",
  description: "Send yourself a password-reset link.",
};

export default function ForgotPasswordRoute() {
  return (
    <CTAuthShell>
      <CTForgotPasswordForm />
    </CTAuthShell>
  );
}
