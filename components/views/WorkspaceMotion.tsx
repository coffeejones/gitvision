"use client";

// WorkspaceMotion — a hydration-safe reveal controller for the session UI.
//
// The first implementation added `.in` directly with classList. That worked
// visually, but on a client-side Next.js navigation the persistent SessionShell
// could mutate freshly streamed page nodes before React finished hydrating
// them. The server said `class="..."`; the DOM already said `class="... in"`,
// so React correctly reported a hydration mismatch and refused to reconcile it.
//
// This version uses the Web Animations API. Animations affect presentation
// without changing class/style attributes, so React remains the sole owner of
// the rendered DOM. Above-the-fold panels are left untouched; off-screen panels
// are held at the first keyframe and played once they intersect. If animation,
// IntersectionObserver or motion preference support is unavailable, everything
// simply stays visible.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const SPRING_EASING =
  "linear(0, 0.0059 0.9%, 0.0234 1.9%, 0.0894 4%, 0.2005 6.5%, 0.4084 10.4%, 0.7233 16.4%, 0.8221 19%, 0.9022 21.7%, 0.9634 24.6%, 1.0064 27.7%, 1.0294 31%, 1.0355 34.6%, 1.0327 39.1%, 1.0221 46.4%, 1.0056 58.7%, 0.9992 69.8%, 0.9998 92%, 1)";

interface RevealAnimations {
  opacity: Animation;
  transform: Animation;
}

function holdOffscreen(el: HTMLElement): RevealAnimations | null {
  // Chromium versions that predate linear() support in the Web Animations API
  // still accept the cubic-bezier approximation. Try the signed-off spring
  // first, then degrade motion quality rather than removing the reveal.
  for (const easing of [SPRING_EASING, "cubic-bezier(0.22, 1, 0.36, 1)"]) {
    let opacity: Animation | null = null;
    let transform: Animation | null = null;
    try {
      opacity = el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 600,
        easing: "ease",
        fill: "both",
      });
      transform = el.animate(
        [{ transform: "translateY(14px)" }, { transform: "none" }],
        {
          duration: 850,
          easing,
          fill: "both",
        },
      );

      // `animate()` starts immediately. Pause on the first frame before the
      // browser paints; the panel is off-screen, so this cannot create a blink.
      opacity.pause();
      transform.pause();
      opacity.currentTime = 0;
      transform.currentTime = 0;
      return { opacity, transform };
    } catch {
      opacity?.cancel();
      transform?.cancel();
    }
  }

  // If even the baseline Web Animations path is unavailable, the enhancement
  // disappears but the panel remains readable.
  return null;
}

function play(reveal: RevealAnimations): void {
  reveal.opacity.play();
  reveal.transform.play();
}

function cancel(reveal: RevealAnimations): void {
  reveal.opacity.cancel();
  reveal.transform.cancel();
}

export function WorkspaceMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".ct-ws");
    if (!root) return;
    const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-rv]"));
    if (panels.length === 0) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (
      reduced ||
      typeof IntersectionObserver === "undefined" ||
      typeof HTMLElement.prototype.animate !== "function"
    ) {
      return;
    }

    const viewportHeight = window.innerHeight;
    const held = new Map<HTMLElement, RevealAnimations>();
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      const inView = rect.top < viewportHeight * 0.92 && rect.bottom > 0;
      if (inView) continue;
      const reveal = holdOffscreen(panel);
      if (reveal) held.set(panel, reveal);
    }

    if (held.size === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const panel = entry.target as HTMLElement;
          const reveal = held.get(panel);
          if (reveal) play(reveal);
          observer.unobserve(panel);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    held.forEach((_reveal, panel) => observer.observe(panel));

    return () => {
      observer.disconnect();
      held.forEach(cancel);
    };
  }, [pathname]);

  return null;
}
