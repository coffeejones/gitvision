// /login — sign-in page (v0.76 / D4 polish).
//
// Server Component. Reads the session up-front so already-logged-in
// users get bounced back to / instead of staring at a login form they
// don't need. The actual form is a Client Component (AuthForm).
//
// D3 addition: when ?reset=ok is in the URL we show a confirmation
// banner above the form. /reset-password redirects here after a
// successful password update — the user needs to sign in fresh with
// the new credentials.
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = {
  title: "Log in — RepoJury",
  description: "Log in to access your saved sessions.",
};

interface SearchParams {
  /** Where to send the user after a successful login. Set by the
   *  navigation links — e.g. clicking "Log in" from /session/abc
   *  passes ?next=/session/abc so they return where they were. */
  next?: string;
  /** Set by /reset-password after a successful password change.
   *  Triggers a confirmation banner above the form. */
  reset?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Next.js 16: searchParams is async now.
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    // Already logged in — skip the form entirely.
    redirect(params.next ?? "/");
  }

  const justReset = params.reset === "ok";

  return (
    <AuthShell>
      {justReset && (
        <div className="auth-banner" role="status">
          <CheckCircle2 size={14} />
          <span>Password updated — sign in with your new password below.</span>
        </div>
      )}
      <AuthForm mode="login" redirectTo={params.next ?? "/"} />
    </AuthShell>
  );
}
