"use client";

// WorkspaceMotion — the reveal engine for the session workspace (Phase 2 / Move D).
//
// This is the landing's reveal layer (CTMotion) ported into the app, stripped
// to ONE responsibility: fade + lift each top-level [data-rv] panel as it
// scrolls into view. Deliberately NOT Lenis smooth-scroll or hero parallax —
// hijacking scroll inside a working tool (canvas panning, long evidence lists)
// would be intrusive. Restraint-first: reveal PANELS, never rows.
//
// Same signature as the landing so the two surfaces feel continuous: the exact
// damped-spring linear() easing Jonas signed off on (peaks ~3.5% overshoot),
// and CSS owns the transition — JS only toggles `.in`.
//
// FOUC-safe, which the landing doesn't need but an app does: panels render
// VISIBLE by default. On mount we (1) mark every panel already in the viewport
// `.in` up front so above-the-fold content never blinks, (2) add `.rv-armed` to
// the shell so the remaining off-screen panels hide, then (3) reveal them on
// scroll. If JS never runs (or IntersectionObserver is missing, or
// prefers-reduced-motion), nothing is armed and every panel stays fully
// visible — the reveal is pure enhancement, never a precondition for reading.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// The damped spring is shared verbatim with the landing (CodeTrawlLanding CSS).
// Above-the-fold panels get `.in` before arming, so this easing only ever plays
// on the scroll reveal — a small, forward, springy settle.
const REVEAL_CSS = `
.ct-ws [data-rv] {
  transition: opacity 0.6s ease,
    transform 0.85s cubic-bezier(0.22, 1, 0.36, 1);
  transition-timing-function: ease, linear(0, 0.0059 0.9%, 0.0234 1.9%, 0.0894 4%, 0.2005 6.5%, 0.4084 10.4%, 0.7233 16.4%, 0.8221 19%, 0.9022 21.7%, 0.9634 24.6%, 1.0064 27.7%, 1.0294 31%, 1.0355 34.6%, 1.0327 39.1%, 1.0221 46.4%, 1.0056 58.7%, 0.9992 69.8%, 0.9998 92%, 1);
}
/* The hide (on arm) is INSTANT — transition:none — so an off-screen panel that
   painted visible during load doesn't fade OUT when JS boots. Only the reveal
   (.in, governed by the base rule above) animates: panels fade + lift IN as
   they scroll into view, never out. */
.ct-ws.rv-armed [data-rv]:not(.in) {
  opacity: 0;
  transform: translateY(14px);
  transition: none;
  will-change: opacity, transform;
}
.ct-ws.rv-armed [data-rv="left"]:not(.in) { transform: translateX(-24px); }
.ct-ws.rv-armed [data-rv="right"]:not(.in) { transform: translateX(24px); }
.ct-ws [data-rv].in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .ct-ws [data-rv] { transition: none; }
}
`;

export function WorkspaceMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".ct-ws");
    if (!root) return;
    const rvs = Array.from(root.querySelectorAll<HTMLElement>("[data-rv]"));
    if (rvs.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      rvs.forEach((el) => el.classList.add("in"));
      return;
    }

    // Mark already-visible panels revealed BEFORE arming, so above-the-fold
    // content is static (no blink, no needless animation on a tool you came to
    // read). Only genuinely off-screen panels get the scroll reveal.
    const vh = window.innerHeight;
    const offscreen: HTMLElement[] = [];
    for (const el of rvs) {
      if (el.classList.contains("in")) continue;
      const r = el.getBoundingClientRect();
      const inView = r.top < vh * 0.92 && r.bottom > 0;
      if (inView) el.classList.add("in");
      else offscreen.push(el);
    }
    root.classList.add("rv-armed");

    if (offscreen.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
    );
    offscreen.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // Re-run on client-side tab navigation: the new route mounts fresh
    // [data-rv] panels that need observing. Already-revealed panels keep `.in`.
  }, [pathname]);

  return <style>{REVEAL_CSS}</style>;
}
