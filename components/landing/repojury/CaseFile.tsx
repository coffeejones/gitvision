"use client";

// CaseFile — ACT IV accordion (V2). One department open at a time:
// clicking a closed bar reveals everything that department investigates
// and collapses the previous one (animated via grid-template-rows).
//
// Each box is a DEPARTMENT, not a single feature — so Forensics shows
// bus factor, untested hotspots, history/churn AND blast radius (one of
// several), instead of making blast radius the whole story. The score
// chip on each bar ties back to ACT III's department bars: open a
// department to see the findings behind its score. Findings are
// explored in the Chambers (the workspace you step into after login).

import { useState } from "react";

type Find = { name: string; ev: string };
type Dept = {
  id: string;
  name: string;
  mandate: string;
  score: number;
  tone: "ok" | "warn" | "bad";
  finds: Find[];
};

// Ordered + scored to mirror ACT II's departments and ACT III's bars.
const DEPTS: Dept[] = [
  {
    id: "health",
    name: "Health Department",
    mandate: "Complexity, duplication, architectural drift",
    score: 64,
    tone: "warn",
    finds: [
      { name: "Complexity hotspots", ev: "ledger.ts · cyclomatic 58 · 12 files over 30" },
      { name: "Code duplication", ev: "7 clusters · 1,840 duplicated lines" },
      { name: "Architectural drift", ev: "9 circular dependencies" },
      { name: "Tight coupling", ev: "auth · payments · users entangled" },
    ],
  },
  {
    id: "security",
    name: "Security Bureau",
    mandate: "Secrets, risky patterns, known CVEs",
    score: 91,
    tone: "ok",
    finds: [
      { name: "Supply-chain incidents", ev: "10 curated attacks · 0 matched" },
      { name: "Secret scanning", ev: "source + config · 0 leaked" },
      { name: "Risky patterns", ev: "eval / new Function / exec · 1 noted" },
      { name: "Known CVEs", ev: "advisory cross-check · 0 critical" },
    ],
  },
  {
    id: "forensics",
    name: "Forensics Lab",
    mandate: "Bus factor, untested hotspots, git history",
    score: 48,
    tone: "bad",
    finds: [
      { name: "Bus factor", ev: "auth/ · 62 commits · 1 author" },
      { name: "Untested hotspots", ev: "ledger.ts · 1,240 LOC · 0 tests" },
      { name: "History & churn", ev: "high-churn files since launch" },
      { name: "Blast radius", ev: "what breaks before you touch a file" },
    ],
  },
  {
    id: "supply",
    name: "Supply Office",
    mandate: "Dependency health, transitive risk",
    score: 88,
    tone: "ok",
    finds: [
      { name: "Outdated & deprecated", ev: "request deprecated · react major behind" },
      { name: "Transitive risk", ev: "248 transitive dependencies mapped" },
      { name: "Vulnerable versions", ev: "advisory match · 0 critical" },
      { name: "Multi-ecosystem", ev: "npm · cargo · pip · go" },
    ],
  },
];

export function CaseFile() {
  const [open, setOpen] = useState<string>(DEPTS[0].id);

  return (
    <div className="cf">
      {DEPTS.map((d) => {
        const isOpen = open === d.id;
        return (
          <div className={`cf-item${isOpen ? " open" : ""}`} key={d.id}>
            <button
              type="button"
              className="cf-bar"
              aria-expanded={isOpen}
              onClick={() => setOpen(d.id)}
            >
              <span className="cf-titles">
                <span className="cf-title">{d.name}</span>
                <span className="cf-mandate">{d.mandate}</span>
              </span>
              <span className={`cf-score ${d.tone}`}>{d.score}</span>
              <svg
                className="cf-chev"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="cf-panel">
              <div className="cf-panel-inner">
                <ul className="cf-finds">
                  {d.finds.map((f) => (
                    <li className="cf-find" key={f.name}>
                      <span className="cf-find-name">{f.name}</span>
                      <span className="cf-find-ev">{f.ev}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
