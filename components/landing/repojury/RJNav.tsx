"use client";

// Floating pill nav. Gains a more opaque background once the page is
// scrolled (same pattern as the old Codomap Nav, but scoped under .rj).
//
// Auth-aware right side: returning customers (especially on a fresh
// machine) need an obvious way in, so we surface a "Sign in" text link
// next to the "Open a case" CTA whenever the visitor is logged out.
// Once signed in we drop "Sign in" — a freshly-signed-up user with 0
// sessions still sees this landing, and a login link would just
// confuse them; their CTA scrolls to the case-intake field instead.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CrestSeal } from "./seals";
import { authClient } from "@/lib/authClient";

type NavLink = { href: string; label: string };

// Canonical in-page anchors for the landing's sections. The optional
// `links` prop can still override them; the default is the live set.
const DEFAULT_LINKS: NavLink[] = [
  { href: "#process", label: "How it works" },
  { href: "#custody", label: "Chain of custody" },
  { href: "#pricing", label: "Pricing" },
];

export function RJNav({ links = DEFAULT_LINKS }: { links?: NavLink[] } = {}) {
  const [scrolled, setScrolled] = useState(false);
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function focusIntake(e: React.MouseEvent) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    const input = document.querySelector<HTMLInputElement>(".intake input");
    input?.focus();
  }

  return (
    <nav className={scrolled ? "scrolled" : undefined}>
      <div className="brand">
        <CrestSeal className="seal-sm" />
        <span>
          <b>Repo</b>Jury
        </span>
      </div>
      <div className="nav-links">
        {links.map((l) => (
          <a href={l.href} key={l.href}>
            {l.label}
          </a>
        ))}
      </div>
      <div className="nav-right">
        {loggedIn ? (
          <a href="#" className="btn btn-primary" onClick={focusIntake}>
            Open a case
          </a>
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Open a case
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
