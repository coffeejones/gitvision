// Hero — the verdict is the hook, the investigation is the promise.
//
// Phase N narrative rebalance: the page used to read as a one-shot
// "paste URL → get a score → leave" tool (10/10 persona testers said
// so). The verdict stays — it's the sharp, shareable hook — but the
// headline + lede now lead with what you do AFTER: open the case
// file, see why each finding landed, fix what's flagged, and explore
// the evidence until you understand your codebase, not just its grade.
//
// The intake field + sample chips live in HeroIntake (client) so they
// can route into the real analysis flow; the rest of the hero stays a
// server component.

import { VerdictDoc } from "./VerdictDoc";
import { HeroIntake } from "./HeroIntake";

export function Hero() {
  return (
    <section className="hero spot">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <div className="case-tag">
            <span className="dot" /> Case intake · open 24/7
          </div>
          <h1>
            Get a verdict.
            <br />
            Understand the <em>evidence.</em>
          </h1>
          <p className="lede">
            Four departments investigate your codebase — health,
            security, forensics, supply — and hand down a verdict. Then
            you dig into the case file: why each finding landed, what to
            fix first, and the evidence behind every signal.
          </p>
          <HeroIntake />
        </div>
        <VerdictDoc />
      </div>
    </section>
  );
}
