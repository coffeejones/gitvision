"use client";

// CTDepthRail — the brand's signature instrument: a fixed depth gauge on the
// right edge that tracks scroll position from "surface" to "depth" — the
// SURFACE & DEPTH axis made literal. Pure direct-manipulation (the marker
// mirrors scroll, no autonomous animation, so it's reduced-motion safe).
// Ghost/bone ink only; hidden below 1180px where it would crowd content.

import { useEffect, useState } from "react";

export function CTDepthRail() {
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max =
          document.documentElement.scrollHeight - window.innerHeight;
        setP(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="depth-rail" aria-hidden>
      <span className="dr-cap">surface</span>
      <span className="dr-track">
        <span className="dr-marker" style={{ top: `${p * 100}%` }} />
      </span>
      <span className="dr-cap">depth</span>
    </div>
  );
}
