"use client";

// CTHero — centered, type-first stack: H1 → sub → intake → survey panel.
// Client component because it owns the live-mirror state: what you type in
// the intake updates the survey panel's header, fusing the core interaction
// and the hero artifact into one narrative (paste → sweep → survey).
//
// The H1's full stop is orange slot 1 — the period appears exactly once on
// the page, here, and is garnish: the intake CTA is the primary accent.

import { useState } from "react";
import { CTIntake } from "./CTIntake";
import { CTSweepTheater } from "./CTSweepTheater";

export function CTHero() {
  const [repo, setRepo] = useState("");

  return (
    <section className="hero" id="analyze">
      <div className="wrap">
        <h1>
          See to the bottom of any codebase
          <span className="hd-period">.</span>
        </h1>
        <p className="sub">
          Paste a URL. CodeTrawl runs one deterministic sweep — full git
          history, AST-level structure, security, and supply chain — and shows
          its work. The surface grade orients you in seconds. The survey
          underneath — the full report, line by line — is the product.
        </p>
        <CTIntake value={repo} onChange={setRepo} />
        <CTSweepTheater repo={repo} />
        {/* Frame the grade: the panel found a B+ was meaningless without a
            "what is this for". A grade orients; it isn't a pass/fail gate. */}
        <p className="grade-frame">
          A surface grade orients — it isn't a gate. It points you straight at
          what to look at first; the survey beneath is where the work is.
        </p>
      </div>
    </section>
  );
}
