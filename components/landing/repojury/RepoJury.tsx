// RepoJury landing — React port of the approved static mockup.
//
// Aesthetic: "forensic dossier noir" — a dark records office with lit
// warm-paper evidence documents as the focal elements. Your repo goes
// on trial; four departments file evidence; a Verdict score is returned.
//
// All visual styling lives in repojury.css, scoped under `.rj` so the
// bare selectors (nav, section, .btn…) can't leak into the rest of the
// app. Fonts come from next/font and are applied as CSS variables on
// the root. Scroll reveals reuse the global <Reveal> / `.reveal` system.

import "./repojury.css";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";

import { RJNav } from "./RJNav";
import { Hero } from "./Hero";
import { Departments } from "./Departments";
import { Trial } from "./Trial";
import { VerdictFull } from "./VerdictFull";
import { Custody } from "./Custody";
import { Pricing } from "./Pricing";
import { RJFooter } from "./Footer";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  display: "swap",
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
});

// One hidden <defs> so every brass crest can reference the same
// gradient by id (#brass) instead of redeclaring it per SVG.
function RJDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ecd488" />
          <stop offset="0.5" stopColor="#c9a227" />
          <stop offset="1" stopColor="#8f6f17" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function RepoJury() {
  return (
    <div className={`rj ${fraunces.variable} ${hanken.variable} ${splineMono.variable}`}>
      <RJDefs />
      <div className="vignette" aria-hidden />
      <div className="desk-line" aria-hidden />
      <div className="grain" aria-hidden />

      <RJNav />
      <main>
        <Hero />
        <Departments />
        <Trial />
        <VerdictFull />
        <Custody />
        <Pricing />
      </main>
      <RJFooter />
    </div>
  );
}
