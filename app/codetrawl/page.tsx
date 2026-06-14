// Sandbox route for the CodeTrawl rebrand (feat/codetrawl-landing branch).
//
// Iterates on the new landing without touching "/" — no auth redirect, so it
// previews regardless of login state (the real "/" bounces signed-in users to
// /cases). Wired to "/" on this branch once the page is right; noindex while
// it's a work-in-progress.

import type { Metadata } from "next";
import { CodeTrawlLanding } from "@/components/landing/codetrawl/CodeTrawlLanding";

export const metadata: Metadata = {
  title: "CodeTrawl — see to the bottom of any codebase",
  description:
    "One deterministic sweep — git history, structure, security, supply chain — and a survey deep enough to dig into. Computed, never generated.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function CodeTrawlPage() {
  return <CodeTrawlLanding />;
}
