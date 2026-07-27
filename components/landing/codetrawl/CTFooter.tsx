// CTFooter — the public footer, and the only place several real pages are
// reachable from.
//
// It used to be one row of five links, all legal or pricing. That left /help
// (the documentation), /agents (the MCP server) and /exposure (the curated
// supply-chain incident list) reachable from nowhere on the public site — two
// of them weren't even in sitemap.ts, so they were invisible to search as well
// as to visitors. A footer that only carries the links a lawyer asked for
// reads as a project; a footer that maps the product reads as a company, and
// in this case the map was already true, just undrawn.
//
// The fathom rule stays: a hairline with depth-gauge tick marks, the single
// permitted visual nod to the name, and it reads as instrumentation unless you
// know to look.

import Link from "next/link";

const GROUPS: Array<{
  heading: string;
  links: Array<{ href: string; label: string }>;
}> = [
  {
    heading: "Product",
    links: [
      { href: "/#top", label: "Analyze a repo" },
      { href: "/#faultline", label: "Faultline" },
      { href: "/preview", label: "PR preview" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { href: "/agents", label: "MCP server" },
      { href: "/help", label: "Documentation" },
      { href: "/exposure", label: "Incident tracker" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/cookies", label: "Cookies" },
      { href: "/refunds", label: "Refunds" },
    ],
  },
];

export function CTFooter() {
  return (
    <footer className="ct-footer">
      <div className="wrap">
        <div className="fathom" aria-hidden />
        <div className="foot-grid">
          <div className="foot-id">
            <span className="foot-brand">CodeTrawl</span>
            <span className="foot-line">computed, never generated</span>
            <a href="mailto:support@codetrawl.com" className="foot-contact">
              support@codetrawl.com
            </a>
          </div>
          {GROUPS.map((g) => (
            <nav className="foot-col" key={g.heading} aria-label={g.heading}>
              <span className="foot-head">{g.heading}</span>
              {g.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
