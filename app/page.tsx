// Home route. Public face only: the RepoJuryV2 marketing landing for
// anonymous visitors. Signed-in callers belong in the workspace, so they're
// redirected to /cases (which lives under the persistent Chambers shell in
// app/(workspace)). AuthForm calls router.refresh() after login so this
// re-evaluates and the redirect fires without a manual reload.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { RepoJuryV2 } from "@/components/landing/repojury/RepoJuryV2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CodeTrawl — every repo gets a grade",
  description:
    "Sweep any GitHub repo. Four lenses examine health, security, forensics, and supply, then settle on one grade you can defend — from one URL, in seconds.",
};

export default async function Home() {
  const authSession = await auth.api.getSession({ headers: await headers() });
  if (authSession?.user) redirect("/cases");
  return <RepoJuryV2 />;
}
