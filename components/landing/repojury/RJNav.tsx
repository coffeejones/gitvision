"use client";

// Floating pill nav. Gains a more opaque background once the page is
// scrolled (same pattern as the old Codomap Nav, but scoped under .rj).

import { useEffect, useState } from "react";
import Link from "next/link";
import { CrestSeal } from "./seals";

export function RJNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={scrolled ? "scrolled" : undefined}>
      <div className="brand">
        <CrestSeal className="seal-sm" />
        <span>
          <b>Repo</b>Jury
        </span>
      </div>
      <div className="nav-links">
        <a href="#departments">Departments</a>
        <a href="#trial">How it works</a>
        <a href="#custody">Chain of custody</a>
        <a href="#pricing">Pricing</a>
      </div>
      <Link href="/signup" className="btn btn-primary">
        Open a case
      </Link>
    </nav>
  );
}
