// CTFooter — minimal mono microtype under the fathom-rule divider (a
// hairline with depth-gauge tick marks: the single permitted visual nod to
// the name, and it reads as instrumentation unless you know to look).

import Link from "next/link";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
  { href: "/refunds", label: "Refunds" },
];

export function CTFooter() {
  return (
    <footer className="ct-footer">
      <div className="wrap">
        <div className="fathom" aria-hidden />
        <div className="foot-row">
          <span className="foot-brand">CodeTrawl</span>
          <div className="foot-links">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </div>
          <span className="foot-line">computed, never generated</span>
        </div>
      </div>
    </footer>
  );
}
