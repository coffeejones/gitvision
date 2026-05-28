// /signup — account creation page (v0.76 / D4 polish).
//
// Mirror of /login (same Server Component pattern). Already-logged-in
// users skip straight to /. Email verification is NOT required for v1
// — accounts are immediately usable. We'll wire the verification flow
// (Resend + magic links) in Phase D once we have something to verify.
//
// D4: layout now uses AuthShell (split brand panel + form column).

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = {
  title: "Sign up — RepoJury",
  description: "Create a free RepoJury account.",
};

interface SearchParams {
  next?: string;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect(params.next ?? "/");
  }

  return (
    <AuthShell>
      <AuthForm mode="signup" redirectTo={params.next ?? "/"} />
    </AuthShell>
  );
}
