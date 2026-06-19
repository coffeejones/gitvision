// Home route. Public face only: the CodeTrawl marketing landing for
// anonymous visitors. Signed-in callers belong in the workspace, so they're
// redirected to /cases (which lives under the persistent Chambers shell in
// app/(workspace)). AuthForm calls router.refresh() after login so this
// re-evaluates and the redirect fires without a manual reload.
//
// The old RepoJury landing was retired here when CodeTrawl became the root
// experience; the former preview routes (/codetrawl, /landing-v2) now redirect
// to "/" to avoid serving duplicate content.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { CodeTrawlLanding } from "@/components/landing/codetrawl/CodeTrawlLanding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CodeTrawl — see to the bottom of any codebase",
  description:
    "One deterministic sweep — git history, structure, security, supply chain — and a survey deep enough to dig into. Computed, never generated.",
  // Pin the home canonical to the production origin so Railway preview /
  // branch hosts (the metadataBase resolves per-host) don't get indexed as
  // a duplicate of the landing page.
  alternates: { canonical: "/" },
};

export default async function Home() {
  const authSession = await auth.api.getSession({ headers: await headers() });
  if (authSession?.user) redirect("/cases");
  return <CodeTrawlLanding />;
}
