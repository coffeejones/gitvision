// RepoJury landing — the consolidated process-arc page (Phase V2).
//
// The middle of the old landing (Departments / How-it-works /
// Verdict-in-full / Investigation) is collapsed into ONE process arc —
// <Process> — so a visitor gets the whole story (how we analyse → what
// we weigh → the verdict → the case file you come back to) in a single
// scroll instead of a page "the size of the next Harry Potter book".
//
// Chain of custody stays its own section (privacy is load-bearing and
// deserves the dedicated treatment). Hero and Pricing are reused. This
// is the live "/" landing for marketing visitors (see app/page.tsx).

import { RJSurface } from "./RJSurface";
import { RJNav } from "./RJNav";
import { Hero } from "./Hero";
import { Process } from "./Process";
import { CustodyCards } from "./CustodyCards";
import { Pricing } from "./Pricing";
import { RJFooter } from "./Footer";

export function RepoJuryV2() {
  return (
    <RJSurface>
      <RJNav />
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
