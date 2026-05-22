"use client";

// Subtle on-scroll fade-in + slide-up wrapper (v0.76 / D4 polish).
//
// Wrap a section in <ScrollReveal> and it'll start at opacity:0
// translateY(12px) and animate to its resting position when its
// viewport intersection threshold is crossed. Once revealed, the
// observer disconnects — we don't re-hide on scroll-back-up, which
// would be distracting on long pages.
//
// Tuning notes:
//   - 16px slide is enough to register without feeling animated for
//     animation's sake. Linear / Vercel use ~12-20px.
//   - 600ms duration with ease-out is the "premium" feel — fast
//     enough that the page doesn't feel sluggish, slow enough to
//     read as deliberate.
//   - rootMargin: "-60px" delays the trigger until the section is
//     ~60px into the viewport. Stops a too-eager fire when the
//     section is just barely peeking above the fold.
//   - Honours prefers-reduced-motion — visitors who've opted out
//     get the content instantly with no animation.
//
// The optional `delay` prop lets us stagger sequential children
// (e.g. four demo cards revealing one after another).

import { useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  /** Milliseconds to delay the reveal after the threshold is crossed.
   *  Used for staggering — first card no delay, second 60ms, etc. */
  delay?: number;
  /** Additional class names (e.g. layout) applied to the wrapper. */
  className?: string;
}

export function ScrollReveal({ children, delay = 0, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Honour prefers-reduced-motion: reveal instantly, no animation.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true);
      return;
    }

    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            const t = setTimeout(() => setVisible(true), delay);
            // Store timeout id on the observer's element so we can
            // clear it in cleanup (rare race: observer fires, then
            // component unmounts before delay elapses).
            (el as HTMLDivElement & { __revealTimer?: number }).__revealTimer =
              t as unknown as number;
          } else {
            setVisible(true);
          }
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "-60px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      const t = (el as HTMLDivElement & { __revealTimer?: number })
        .__revealTimer;
      if (t) clearTimeout(t);
    };
  }, [delay]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 600ms ease-out, transform 600ms ease-out",
      }}
    >
      {children}
    </div>
  );
}
