// CodeTrawl landing — "SURFACE & DEPTH" composition (slice 1).
//
// Direction chosen by a 3-direction × 3-judge panel (unanimous): editorial-
// technical manifesto — broadsheet type on bitumen black, hairlines instead
// of cards, International Orange rationed to ~6 budgeted slots, and the
// sweep-log survey panel as the page's one big artifact.
//
// Full composition: Nav · Hero (H1 / intake / survey panel) · Credibility
// stripe · Manifesto + signal traces · Four lenses (editorial rows) ·
// Computed-vs-model contrast · Compare table · Pricing band · Footer.

import { CTSurface } from "./CTSurface";
import { CTNav } from "./CTNav";
import { CTHero } from "./CTHero";
import { CTStripe } from "./CTStripe";
import { CTManifesto } from "./CTManifesto";
import { CTLenses } from "./CTLenses";
import { CTShowcase } from "./CTShowcase";
import { CTComputed } from "./CTComputed";
import { CTCompare } from "./CTCompare";
import { CTPricingBand } from "./CTPricingBand";
import { CTFooter } from "./CTFooter";
import { CTDepthRail } from "./CTDepthRail";

export function CodeTrawlLanding() {
  return (
    <CTSurface>
      <CTDepthRail />
      <CTNav />
      <main>
        <CTHero />
        <CTStripe />
        <CTManifesto />
        <CTLenses />
        <CTShowcase />
        <CTComputed />
        <CTCompare />
        <CTPricingBand />
      </main>
      <CTFooter />
    </CTSurface>
  );
}
