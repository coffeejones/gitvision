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
import { loadDemoHighlights } from "@/lib/demoHighlights";

export const dynamic = "force-dynamic";

const TITLE = "CodeTrawl — evidence for every code change";
const DESCRIPTION =
  "Deterministic repository intelligence for change impact, security posture and system understanding. Start with one GitHub repository — free, private repos included.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Pin the home canonical to the production origin so Railway preview /
  // branch hosts (the metadataBase resolves per-host) don't get indexed as
  // a duplicate of the landing page.
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "CodeTrawl",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CodeTrawl — understand the system and change it with confidence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default async function Home() {
  const authSession = await auth.api.getSession({ headers: await headers() });
  if (authSession?.user) redirect("/cases");
  // Read the demo sweeps AFTER the redirect — a signed-in visitor never sees
  // the landing, so there's no reason to touch the session store for them.
  const demos = await loadDemoHighlights();
  return <CodeTrawlLanding demos={demos} />;
}
