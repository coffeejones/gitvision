"use client";

// CTMotion — the landing motion layer. Restraint-first, transform-only:

//   1. Lenis smooth scroll (the "buttery" feel; anchors included)
//   2. Reveal engine: adds .in to [data-rv] elements as they enter the viewport
//      (one-shot; CSS owns the actual transition — springy, small, directional)
//   3. Nav scrolled state: .ct-navwrap gets .scrolled after a few px
//   4. Spatial depth: a shared viewport value moves decorative under-planes
//   5. Hero product tilt: pointer-driven, tiny and disabled for reduced motion
// prefers-reduced-motion: everything is marked .in immediately, no Lenis, no
// reveal transitions — the page renders finished and static.

import { useEffect } from "react";
import Lenis from "lenis";

export function CTMotion() {
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

    // 3 + 4 · nav state and decorative depth share one rAF-throttled scroll
    // handler. Only CSS custom properties change; content never moves, so the
    // effect cannot disturb reading order or the sticky tour's chapter logic.
    // CTNav renders .ct-navwrap — shared with every other public page, which
    // is why the selector is no longer the landing's own .rk-* namespace.
    const nav = document.querySelector<HTMLElement>(".ct-navwrap");
    const depthPlanes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-rv-depth]")
    );
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
        const viewportCenter = window.innerHeight / 2;
        const depthValues = depthPlanes.map((plane) => {
          const rect = plane.getBoundingClientRect();
          const elementCenter = rect.top + rect.height / 2;
          const depth = Math.max(
            -1,
            Math.min(1, (elementCenter - viewportCenter) / window.innerHeight)
          );
          return { plane, depth };
        });
        depthValues.forEach(({ plane, depth }) => {
          plane.style.setProperty("--rv-depth-sm", `${(depth * -3).toFixed(2)}px`);
          plane.style.setProperty("--rv-depth-md", `${(depth * -6).toFixed(2)}px`);
          plane.style.setProperty("--rv-depth-lg", `${(depth * -11).toFixed(2)}px`);
        });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();

    // 5 · product depth. The frame moves by at most a few degrees and returns
    // to neutral as soon as the pointer leaves; touch never enters this path.
    const heroProduct = document.querySelector<HTMLElement>(".rv-hero-product");
    let pointerFrame = 0;
    const onProductMove = (event: PointerEvent) => {
      if (!heroProduct || event.pointerType === "touch") return;
      const rect = heroProduct.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        heroProduct.style.setProperty("--rv-tilt-x", `${-y * 2.4}deg`);
        heroProduct.style.setProperty("--rv-tilt-y", `${x * 3.2}deg`);
      });
    };
    const resetProduct = () => {
      if (!heroProduct) return;
      heroProduct.style.setProperty("--rv-tilt-x", "0deg");
      heroProduct.style.setProperty("--rv-tilt-y", "0deg");
    };
    heroProduct?.addEventListener("pointermove", onProductMove, { passive: true });
    heroProduct?.addEventListener("pointerleave", resetProduct);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(pointerFrame);
      heroProduct?.removeEventListener("pointermove", onProductMove);
      heroProduct?.removeEventListener("pointerleave", resetProduct);
      io.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}
