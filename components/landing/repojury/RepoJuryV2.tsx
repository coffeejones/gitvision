// RepoJuryV2 — the consolidated landing (Phase V2).
//
// Same forensic-dossier shell as the "/" landing, but the middle is
// collapsed from four separate sections (Departments / How-it-works /
// Verdict-in-full / Investigation) into ONE process arc — <Process> —
// so a visitor gets the whole story (how we analyse → what we weigh →
// the verdict → the case file you come back to) in a single scroll
// instead of a page "the size of the next Harry Potter book".
//
// Chain of custody stays its own section (privacy is load-bearing and
// deserves the dedicated three-stage treatment). Hero and Pricing are
// reused verbatim. This composition lives behind /preview only — the
// real "/" landing (RepoJury.tsx) is untouched while we compare.

import { RJSurface } from "./RJSurface";
import { RJNav } from "./RJNav";
import { Hero } from "./Hero";
import { Process } from "./Process";
import { CustodyCards } from "./CustodyCards";
import { Pricing } from "./Pricing";
import { RJFooter } from "./Footer";

const NAV_LINKS = [
  { href: "#process", label: "How it works" },
  { href: "#custody", label: "Chain of custody" },
  { href: "#pricing", label: "Pricing" },
];

export function RepoJuryV2() {
  return (
    <RJSurface>
      <RJNav links={NAV_LINKS} />
      <main>
        <Hero />
        <Process />
        <CustodyCards />
        <Pricing />
      </main>
      <RJFooter />
    </RJSurface>
  );
}
