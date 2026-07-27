// "See it on a real repo" — the landing's only instant proof, given the room
// it earns.
//
// The three pre-analyzed public sweeps are the one thing a logged-out visitor
// can actually open: viewing them is anonymous-allowed and isDemoSession()
// unlocks every panel, so what they see is the complete product on a real
// codebase. That path used to be a 12.5px line of grey mono under the intake,
// in --ct-ghost — the token codetrawl.css:62 reserves for "decorative ink that
// conveys nothing" — three lines below a large orange button that sends every
// logged-out visitor to a signup form. The most persuasive thing on the page
// was its quietest element, and the loudest one was a wall.
//
// Each card carries the session's OWN top finding, computed by the same
// pickHeadline() the Overview renders (lib/demoHighlights.ts). Not a claim
// about the product — a result from it.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DemoHighlight } from "@/lib/demoHighlights";
import { formatStars } from "@/lib/demoHighlights";

export function CTDemoProof({ demos }: { demos: DemoHighlight[] }) {
  if (demos.length === 0) return null;

  return (
    <section className="rk-proof" id="demos">
      <div className="rk-proof-head" data-rv>
        <h2 className="rk-h2">Read one now, without signing up.</h2>
        <p className="rk-feat-sub">
          Three repos already swept. Every panel is open — the source, the call
          graph, the findings, the grade. These are the real reports, not a
          tour.
        </p>
      </div>

      <div className="rk-proof-grid" data-rv="cascade">
        {demos.map((d) => (
          <Link
            key={d.sessionId}
            href={`/session/${d.sessionId}`}
            // Without a finding the card has nothing to fill the reserved
            // height with, and a uniform 178px box holding two lines reads as
            // something that failed to load. Let it collapse instead.
            className={`rk-proof-card${d.finding ? "" : " rk-proof-card--bare"}`}
          >
            <span className="rk-proof-repo">{d.repo}</span>
            {(d.language || d.stars !== null) && (
              <span className="rk-proof-meta">
                {d.language}
                {d.language && d.stars !== null ? " · " : ""}
                {d.stars !== null ? `${formatStars(d.stars)} stars` : ""}
              </span>
            )}
            {/* No finding means the session wasn't readable (it lives on the
                production volume). The card stays useful rather than
                inventing a line. */}
            {d.finding && <span className="rk-proof-finding">{d.finding}</span>}
            <span className="rk-proof-cta">
              Open the report
              <ArrowRight size={13} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
