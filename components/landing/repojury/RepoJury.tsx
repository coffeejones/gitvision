// RepoJury landing — React port of the approved static mockup.
//
// Aesthetic: "forensic dossier noir" — a dark records office with lit
// warm-paper evidence documents as the focal elements. Your repo goes
// on trial; four departments file evidence; a Verdict score is returned.
//
// The fonts + `.rj` scope + atmosphere layers now live in RJSurface
// (shared with the auth pages and /pricing so the whole marketing
// funnel reads as one brand). This file just composes the sections.

import { RJSurface } from "./RJSurface";
import { RJNav } from "./RJNav";
import { Hero } from "./Hero";
import { Departments } from "./Departments";
import { Trial } from "./Trial";
import { VerdictFull } from "./VerdictFull";
import { Investigation } from "./Investigation";
import { Custody } from "./Custody";
import { Pricing } from "./Pricing";
import { RJFooter } from "./Footer";

export function RepoJury() {
  return (
    <RJSurface>
      <RJNav />
      <main>
        <Hero />
        <Departments />
        <Trial />
        <VerdictFull />
        <Investigation />
        <Custody />
        <Pricing />
      </main>
      <RJFooter />
    </RJSurface>
  );
}
