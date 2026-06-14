"use client";

// CTNav — sticky top nav. Transparent over the page, gains a hairline once
// scrolled (no fill change, no shadow — hairlines are the page's only
// depth device). Auth-aware right side mirrors the old landing's behavior:
// logged-out visitors get Sign in + a ghost CTA; logged-in users just get
// the CTA (which focuses the intake).

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/authClient";

// Plain-English labels only (lexicon guard) — the coined terms live in body
// copy where they can be paired with their gloss.
const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#lenses", label: "Analysis" },
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

export function CTNav() {
  const [scrolled, setScrolled] = useState(false);
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function focusIntake() {
    // preventScroll keeps focus() from cancelling the smooth scroll with its
    // own instant scroll-into-view; reduced-motion users get an instant jump
    // (the CSS guard can't cover JS-initiated smooth scrolling).
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    document
      .querySelector<HTMLInputElement>(".ct .intake input")
      ?.focus({ preventScroll: true });
  }

  return (
    <nav className={scrolled ? "scrolled" : undefined}>
      <div className="nav-inner">
        <span className="nav-brand">CodeTrawl</span>
        <div className="nav-links">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="nav-right">
          {!loggedIn && (
            <Link href="/login" className="nav-signin">
              Sign in
            </Link>
          )}
          <button type="button" className="nav-cta" onClick={focusIntake}>
            Analyze a repo
          </button>
        </div>
      </div>
    </nav>
  );
}
