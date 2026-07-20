"use client";

// CTShowcase — the "show, don't tell" centerpiece. Six real workspace views,
// one open at a time; click (or arrow-key) another to swap the framed panel.
// The panel is a faithful workspace-panel frame (eyebrow label · title ·
// description · body), the body is the active mock from CTShowcaseMocks.
//
// A proper ARIA tablist: roving tabindex, ←/→/↑/↓ + Home/End move selection,
// each panel a tabpanel. The mock swaps with a one-shot fade (reduced-motion
// renders it static). No new orange is spent — the active tab is marked with
// brightness + a hairline rule, keeping the page's 6-slot budget intact.

import { useRef, useState } from "react";
import { CTReveal } from "./CTReveal";
import { CTClassDiagram } from "./CTClassDiagram";
import {
  HealthScoringMock,
  BlastRadiusMock,
  SecurityMock,
  DuplicatedCodeMock,
  PackagesMock,
} from "./CTShowcaseMocks";

interface Feature {
  id: string;
  tab: string;
  tabSub: string;
  eyebrow: string;
  title: string;
  desc: string;
  Mock: () => React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    id: "health",
    tab: "Health scoring",
    tabSub: "One deterministic grade",
    eyebrow: "Health scoring",
    title: "One repository, one verdict.",
    desc: "Four departments vote from deterministic signals. The grade is their sum, capped by the worst outcome — never an AI's opinion.",
    Mock: HealthScoringMock,
  },
  {
    id: "blast",
    tab: "Blast radius",
    tabSub: "What a change touches",
    eyebrow: "Blast radius",
    title: "What breaks if this changes.",
    desc: "The functions that call a given one and the ones it calls — grouped by how many hops away, so you see exactly what a change reaches.",
    Mock: BlastRadiusMock,
  },
  {
    id: "security",
    tab: "Security",
    tabSub: "Secrets, patterns, incidents",
    eyebrow: "Security",
    title: "What deserves a review.",
    desc: "Three deterministic scanners — secrets, dynamic-execution patterns, known supply-chain incidents — surfaced and sorted by severity.",
    Mock: SecurityMock,
  },
  {
    id: "classes",
    tab: "Class diagram",
    tabSub: "The type graph, drawn",
    eyebrow: "Class diagram",
    title: "The type graph, drawn.",
    desc: "Classes, fields and methods read straight from the AST, with the inheritance between them — laid out automatically. Drag to pan, click a class to trace its connections.",
    Mock: CTClassDiagram,
  },
  {
    id: "duplicates",
    tab: "Duplicated code",
    tabSub: "The same body, copy-pasted",
    eyebrow: "Duplicated code",
    title: "Found in more than one place.",
    desc: "Functions whose bodies are structurally identical — matched by AST hash, not text — grouped so you can see the copies and extract a helper.",
    Mock: DuplicatedCodeMock,
  },
  {
    id: "packages",
    tab: "Packages",
    tabSub: "Vulnerable & outdated",
    eyebrow: "Packages",
    title: "Dependencies, audited.",
    desc: "Every package resolved across ecosystems, then checked for advisories, deprecations and how far behind latest it has drifted.",
    Mock: PackagesMock,
  },
];

export function CTShowcase() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = FEATURES.length - 1;
    let next = active;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const feature = FEATURES[active];
  const Mock = feature.Mock;

  return (
    <section id="features" className="section showcase">
      <div className="wrap">
        <CTReveal className="rv-block">
          <h2 className="sec-h2">What the survey actually shows.</h2>
          <p className="sc-deck">
            Six of the views CodeTrawl renders from a sweep — real layouts,
            sample data. Pick one.
          </p>
        </CTReveal>

        <CTReveal className="rv-block">
          <div className="sc-layout">
            <div
              className="sc-tabs"
              role="tablist"
              aria-label="Feature views"
              aria-orientation="vertical"
              onKeyDown={onKeyDown}
            >
              {FEATURES.map((f, i) => (
                <button
                  key={f.id}
                  ref={(el) => { tabRefs.current[i] = el; }}
                  role="tab"
                  type="button"
                  id={`sc-tab-${f.id}`}
                  aria-selected={i === active}
                  aria-controls="sc-panel"
                  tabIndex={i === active ? 0 : -1}
                  className={`sc-tab ${i === active ? "is-active" : ""}`}
                  onClick={() => setActive(i)}
                >
                  <span className="sc-tab-name">{f.tab}</span>
                  <span className="sc-tab-sub">{f.tabSub}</span>
                </button>
              ))}
            </div>

            <div className="sc-stage">
              <div
                className="sc-panel"
                role="tabpanel"
                id="sc-panel"
                aria-labelledby={`sc-tab-${feature.id}`}
                tabIndex={0}
              >
                <div className="sc-panel-head">
                  <span className="sc-eyebrow">{feature.eyebrow}</span>
                  <h3 className="sc-panel-title">{feature.title}</h3>
                  <p className="sc-panel-desc">{feature.desc}</p>
                </div>
                <div className="sc-panel-body" key={feature.id}>
                  <Mock />
                </div>
              </div>
            </div>
          </div>
        </CTReveal>
      </div>
    </section>
  );
}
