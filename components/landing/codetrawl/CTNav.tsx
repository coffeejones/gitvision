// CTNav — the one public nav.
//
// Before this, five public pages each carried their own hand-copied nav: the
// landing had a 56px pill (.rk-nav, inline CSS), while /pricing, /agents,
// /exposure and /preview shared a 64px full-width bar (.ct nav, codetrawl.css)
// with an outlined CTA instead of the orange one — so one click from the
// landing to the pricing page changed the nav shape, height, container width,
// logo position and CTA styling. Four of those five also linked to /#features
// and /#analyze, neither of which has ever existed on the landing, which meant
// the money page's primary call to action went nowhere.
//
// One component, the landing's pill grammar, absolute hrefs everywhere except
// on the landing itself (where CTMotion's Lenis needs bare "#id" fragments to
// smooth-scroll rather than push a route).
//
// The link set is deliberately not just the landing's own sections: /agents
// (the MCP server) and /help (the documentation) were reachable from nothing,
// and a nav that names them is most of what separates a product site from a
// one-page pitch.

import Link from "next/link";

/** Section links point into the landing page. On the landing they must stay
 *  bare fragments — Lenis (CTMotion, `anchors: true`) intercepts those and
 *  smooth-scrolls; an absolute "/#id" would route instead. Everywhere else
 *  they need the leading "/" to get back home first. */
const SECTIONS = [
  { hash: "how", label: "How it works" },
  { hash: "faultline", label: "Faultline" },
] as const;

const PAGES = [
  { href: "/agents", label: "For agents" },
  { href: "/help", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function CTNav({
  onLanding = false,
}: {
  /** True only on "/" — switches section links to bare fragments and lets
   *  CTMotion own the scrolled state. Off elsewhere, where there is no hero to
   *  float over, so the nav renders in its settled state immediately. */
  onLanding?: boolean;
}) {
  const cta = onLanding ? "#top" : "/#top";

  return (
    <div className={`ct-navwrap${onLanding ? "" : " scrolled"}`}>
      <nav className="ct-nav">
        <Link href="/" className="ct-nav-logo">
          CodeTrawl
        </Link>
        <span className="ct-nav-links">
          {SECTIONS.map((s) => (
            <a
              key={s.hash}
              href={onLanding ? `#${s.hash}` : `/#${s.hash}`}
              className="ct-nav-anchor"
            >
              {s.label}
            </a>
          ))}
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href}>
              {p.label}
            </Link>
          ))}
        </span>
        <span className="ct-nav-right">
          <Link href="/login" className="ct-nav-login">
            Log in
          </Link>
          <a href={cta} className="ct-nav-cta">
            Analyze a repo
          </a>
        </span>
      </nav>
    </div>
  );
}
