// /forgot-password — request a password reset link (v0.76 / D4 polish).
//
// Server Component. Already-logged-in callers don't need this flow,
// but unlike /login + /signup we DON'T redirect them away — they may
// be helping a teammate reset, or testing the flow. The form just
// works either way.
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = {
  title: "Reset your password — RepoBaron",
  description: "Send yourself a password-reset link.",
};

export default function ForgotPasswordRoute() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
