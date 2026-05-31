"use client";

// The hero centerpiece: a lit "verdict document" on the dark desk.
// On mount, the score ring sweeps to 72% and the number counts up
// 0 → 72 (skipped under prefers-reduced-motion). The CAUTION stamp
// and doc entrance are CSS-driven (see repojury.css).

import { useEffect, useRef } from "react";
import { CrestSeal } from "./seals";

const CIRC = 327; // 2πr, r = 52
const TARGET = 72;

export function VerdictDoc() {
  const ring = useRef<SVGCircleElement>(null);
  const num = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      if (ring.current) ring.current.style.strokeDashoffset = String(CIRC - (CIRC * TARGET) / 100);
      if (num.current) num.current.textContent = `${TARGET}/100`;
      return;
    }
    let raf = 0;
    let t0 = 0;
    const dur = 1300;
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      if (ring.current) ring.current.style.strokeDashoffset = String(CIRC - (CIRC * e * TARGET) / 100);
      if (num.current) num.current.textContent = `${Math.round(e * TARGET)}/100`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const start = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 700);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="doc-stage">
      <div className="doc-stack">
        {/* dimmed exhibit sheets fanned behind the verdict, so the hero
            reads as a case file on a desk, not one floating card */}
        <span className="doc-ghost g2" aria-hidden />
        <span className="doc-ghost g1" aria-hidden />
        <article className="verdict-doc">
          <div className="tape" />
        <div className="doc-head">
          <div className="doc-case">
            <b>Verdict</b>CASE No. 2026-0481
          </div>
          <CrestSeal size={42} className="seal" />
        </div>
        <div className="doc-repo">
          github.com/<b>acme/payments-api</b>
        </div>
        <div className="verdict-row">
          <div className="score-ring">
            <svg width="118" height="118" viewBox="0 0 118 118">
              <circle cx="59" cy="59" r="52" fill="none" stroke="rgba(86,80,63,.18)" strokeWidth={9} />
              <circle
                ref={ring}
                cx="59"
                cy="59"
                r="52"
                fill="none"
                stroke="#d29a31"
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC}
              />
            </svg>
            <div className="grade">
              <span className="g">B&minus;</span>
              <span className="n" ref={num}>
                0/100
              </span>
            </div>
          </div>
          <div>
            <div className="verdict-label">Returned verdict</div>
            <div className="verdict-word">
              Caution
              <br />
              advised
            </div>
            <div className="verdict-sub">Ships, but two findings need an owner before you bet on it.</div>
          </div>
        </div>
        <div className="doc-depts">
          <div className="dd">
            <span className="s warn" /> Health · drift rising
          </div>
          <div className="dd">
            <span className="s ok" /> Security · clear
          </div>
          <div className="dd">
            <span className="s bad" /> Forensics · bus factor 1
          </div>
          <div className="dd">
            <span className="s ok" /> Supply · current
          </div>
        </div>
        <div className="stamp">Caution</div>
        <div className="doc-foot">
          <span>Sealed sandbox · evidence destroyed</span>
          <span>2026·05·29</span>
        </div>
        </article>
      </div>
    </div>
  );
}
