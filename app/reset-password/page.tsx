// /reset-password?token=xxx — set a new password using a token from
// the reset email (v0.76 / D4 polish).
//
// Server Component. Reads the token from search params and hands it
// off to the client form. If the token is missing or invalid, the
// form surfaces the right error state (Better Auth returns a clear
// "token expired" message we pass through verbatim).
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = {
  title: "Set a new password — RepoBaron",
  description: "Choose a new password for your RepoBaron account.",
};

interface SearchParams {
  /** Single-use, signed token from Better Auth. Email link includes
   *  it as ?token=... */
  token?: string;
}

export default async function ResetPasswordRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Next.js 16: searchParams is async.
  const params = await searchParams;

  return (
    <AuthShell>
      <ResetPasswordForm token={params.token ?? null} />
    </AuthShell>
  );
}
