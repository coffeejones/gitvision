// /preview — side-by-side preview of the consolidated V2 landing.
//
// Non-destructive: "/" still serves the current full landing
// (app/page.tsx → RepoJury). This route always renders the V2
// process-arc composition regardless of auth/session state, so Jonas
// can compare the two without logging out or clearing sessions.
//
// noindex: this is an internal comparison surface, not public content.

import type { Metadata } from "next";
import { RepoJuryV2 } from "@/components/landing/repojury/RepoJuryV2";

export const metadata: Metadata = {
  title: "RepoJury — process preview",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <RepoJuryV2 />;
}
