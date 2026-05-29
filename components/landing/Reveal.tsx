"use client";

// Scroll-triggered reveal. Adds the `.in` class when the element
// crosses the viewport threshold so the CSS transition fires. Used
// instead of Framer Motion's `whileInView` because Framer Motion v12
// has known issues with React 19 in dev where animations stick at
// the initial state — pure CSS sidesteps the whole problem.
//
// `delay` is just sugar that maps to the CSS `--delay` variable
// consumed by `.reveal` in globals.css.

import { useState, useEffect, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "article" | "li" | "header" | "p" | "h2" | "h3";
};

export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: Props) {
  // Callback ref instead of useRef — sidesteps React 19's stricter
  // typing on polymorphic `as` (the intersection of every supported
  // tag's HTMLElement subtype narrows to `never`). A callback ref
  // accepts any HTMLElement uniformly.
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!el) return;
    // Already past viewport on mount → reveal immediately (handles
    // refresh-mid-scroll). IntersectionObserver also fires for
    // already-intersecting elements on the first poll, but doing it
    // synchronously prevents one frame of "blank" content.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el]);

  return (
    <Tag
      ref={setEl as never}
      style={delay ? ({ "--delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={`reveal ${className}`}
    >
      {children}
    </Tag>
  );
}
