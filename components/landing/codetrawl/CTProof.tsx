// The numbers strip — and the landing's doorway to its own depth.
//
// Two problems, one component. The page stated no quantity at all except "about
// a minute" and "eight"; every figure the product could honestly claim was
// trapped inside screenshot pixels. And /agents, /exposure and /security are
// substantial pages that a visitor had no reason to click through to.
//
// So each figure links to the page that proves it. The strip is the evidence
// and the navigation at the same time, which is why it sits between the demo
// cards and the feature sections rather than being decoration in the footer.
//
// WHY THE NUMBERS ARE WRITTEN OUT HERE and not derived: importing
// lib/codeAnalysis/plugins/all.ts to count languages would pull web-tree-sitter
// and eight WASM grammars into the landing page's bundle for a "7". The
// lockstep is enforced by lib/__tests__/landingProof.test.ts instead, which
// fails when a language, an ecosystem, an MCP tool or an incident is added —
// the number gets updated because a test says so, not because someone
// remembered.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export interface ProofStat {
  figure: string;
  label: string;
  detail: string;
  href: string;
}

export const PROOF_STATS: ProofStat[] = [
  {
    figure: "7",
    label: "languages read to a call graph",
    // Named on purpose: "7 languages" is a claim, the list is checkable. JS and
    // TS share one plugin, which is why this says seven and not eight.
    detail:
      "JavaScript/TypeScript, Python, Go, Java, C#, PHP and Ruby — parsed to functions, calls and complexity, not matched with regexes.",
    href: "/help",
  },
  {
    figure: "0",
    label: "AI in the analysis",
    detail:
      "Cloning, parsing, the call graph and every signal are computed by code. The AI layer sits on top and can be switched off entirely.",
    href: "/security",
  },
  {
    figure: "10",
    label: "tools your agent can call",
    detail:
      "The same analysis over MCP — blast radius, untested hotspots, a pre-commit change simulation. One npx command.",
    href: "/agents",
  },
  {
    figure: "10",
    label: "supply-chain attacks, by version",
    detail:
      "Named, dated incidents matched against the exact package versions a repo still declares — not a generic advisory feed.",
    href: "/exposure",
  },
];

export function CTProof() {
  return (
    <section className="rk-stats" id="proof">
      <div className="rk-stats-grid" data-rv="cascade">
        {PROOF_STATS.map((s) => (
          <Link key={s.href} href={s.href} className="rk-stat">
            <span className="rk-stat-figure">{s.figure}</span>
            <span className="rk-stat-label">
              {s.label}
              <ArrowUpRight size={13} className="rk-stat-arrow" />
            </span>
            <span className="rk-stat-detail">{s.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
