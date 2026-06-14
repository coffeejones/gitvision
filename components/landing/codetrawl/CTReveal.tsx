"use client";

// CTReveal — scroll-triggered reveal wrapper. Adds .ct-in once the element
// enters the viewport (one-shot). Two usage modes, styled in codetrawl.css:
//   <CTReveal className="rv-block">…           — the whole block rises in
//   <CTReveal>…children with .rv-i + delays…   — children cascade
// prefers-reduced-motion renders everything visible immediately.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function CTReveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`ct-rv ${inView ? "ct-in" : ""} ${className}`}>
      {children}
    </div>
  );
}
