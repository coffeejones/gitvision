// /reset-password?token=xxx — set a new password using a token from
// the reset email (v0.76 / D4 polish).
//
// Server Component. Reads the token from search params and hands it
// off to the client form. If the token is missing or invalid, the
// form surfaces the right error state (Better Auth returns a clear
// "token expired" message we pass through verbatim).
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { CTResetPasswordForm } from "@/components/landing/codetrawl/CTResetPasswordForm";
import { CTAuthShell } from "@/components/landing/codetrawl/CTAuthShell";

export const metadata = {
  title: "Set a new password — CodeTrawl",
  description: "Choose a new password for your CodeTrawl account.",
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
    <CTAuthShell>
      <CTResetPasswordForm token={params.token ?? null} />
    </CTAuthShell>
  );
}
