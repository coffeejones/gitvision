"use client";

// DraftMotion — the motion layer for the landing draft. THROWAWAY (ports to the
// real landing later). Four jobs, all restraint-first and transform-only:
//   1. Lenis smooth scroll (the "buttery" feel; anchors included)
//   2. Reveal engine: adds .in to [data-rv] elements as they enter the viewport
//      (one-shot; CSS owns the actual transition — springy, small, directional)
//   3. Hero parallax: the hero shot drifts slightly slower than the page
//   4. Nav scrolled state: .rk-navwrap gets .scrolled after a few px
// prefers-reduced-motion: everything is marked .in immediately, no Lenis, no
// parallax — the page renders finished and static.

import { useEffect } from "react";
import Lenis from "lenis";

export function DraftMotion() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rvs = Array.from(document.querySelectorAll<HTMLElement>("[data-rv]"));

    if (reduced) {
      rvs.forEach((el) => el.classList.add("in"));
      return;
    }

    // 1 · smooth scroll (autoRaf runs its own loop; anchors smooth-scroll too)
    const lenis = new Lenis({ autoRaf: true, anchors: true });

    // 2 · reveals — one-shot, slightly early so motion finishes as you arrive
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    rvs.forEach((el) => io.observe(el));

    // 3 + 4 · parallax + nav state, one rAF-throttled scroll handler
    const shot = document.querySelector<HTMLElement>(".rk-hero-shot");
    const nav = document.querySelector<HTMLElement>(".rk-navwrap");
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        if (shot) {
          // drift slower than the page while the hero is on screen; capped
          const drift = Math.min(y * 0.08, 64);
          shot.style.transform = `translateX(-50%) translateY(${drift}px)`;
        }
        if (nav) nav.classList.toggle("scrolled", y > 8);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}
