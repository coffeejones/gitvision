// /exposure/[id] — the "check your exposure to <attack>" page (Arc 4, beat 2).
// One per curated incident; the shareable landing when an attack hits the news.
// Explains the incident, lists the confirmed-compromised packages, and points
// the reader at how to check their own repo. Statically generated from
// lib/security/knownIncidents.ts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ctMono } from "@/components/landing/codetrawl/ctFonts";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";
import { KNOWN_INCIDENTS } from "@/lib/security/knownIncidents";
import { ECOSYSTEM_LABEL, formatIncidentDate } from "../format";

const MONO = ctMono.style.fontFamily;
const ORANGE = "#ff4f00";
const BONE = "#eceae8";
const MUTED = "rgba(255,255,255,0.58)";
const SURFACE = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.10)";

function incidentById(id: string) {
  return KNOWN_INCIDENTS.find((i) => i.id === id) ?? null;
}

export function generateStaticParams() {
  return KNOWN_INCIDENTS.map((i) => ({ id: i.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const inc = incidentById(id);
  if (!inc) return { title: "Incident not found | CodeTrawl" };
  return {
    title: `Are you exposed to the ${inc.name}? | CodeTrawl`,
    description: `${inc.shortDescription} Check whether your repo still ships a compromised version.`,
  };
}

export default async function ExposureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const inc = incidentById(id);
  if (!inc) notFound();

  const pkgCount = new Set(inc.affectedPackages.map((p) => p.name)).size;

  return (
    <CTSurface>
      <nav className="scrolled">
        <div className="nav-inner">
          <Link href="/" className="nav-brand">
            CodeTrawl
          </Link>
          <div className="nav-links">
            <Link href="/#how">How it works</Link>
            <Link href="/#features">Features</Link>
            <Link href="/exposure">Incidents</Link>
            <Link href="/pricing">Pricing</Link>
          </div>
          <div className="nav-right">
            <Link href="/login" className="nav-signin">
              Sign in
            </Link>
            <Link href="/#analyze" className="nav-cta">
              Analyze a repo
            </Link>
          </div>
        </div>
      </nav>

      <main className="wrap" style={{ paddingBottom: 96 }}>
        <header
          className="price-hero"
          style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}
        >
          <span className="eyebrow">
            <Link href="/exposure" style={{ color: "inherit", textDecoration: "none" }}>
              Incident tracker
            </Link>{" "}
            · {formatIncidentDate(inc.discoveredAt)}
          </span>
          <h1>Are you exposed to the {inc.name}?</h1>
          <p className="lede">{inc.shortDescription}</p>
        </header>

        <section style={{ maxWidth: 720, margin: "64px auto 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span className="eyebrow" style={{ margin: 0 }}>
              Confirmed-compromised packages
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: MUTED }}>
              {pkgCount} package{pkgCount === 1 ? "" : "s"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER}` }}>
            {inc.affectedPackages.map((p, i) => (
              <div
                key={`${p.ecosystem}:${p.name}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(90px, 120px) 1fr",
                  gap: 16,
                  padding: "13px 16px",
                  background: i % 2 === 0 ? SURFACE : "transparent",
                  borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
                  alignItems: "baseline",
                }}
              >
                <code style={{ fontFamily: MONO, fontSize: 12.5, color: ORANGE }}>
                  {ECOSYSTEM_LABEL(p.ecosystem)}
                </code>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <code style={{ fontFamily: MONO, fontSize: 14, color: BONE }}>{p.name}</code>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: MUTED, wordBreak: "break-word" }}>
                    compromised: {p.compromisedVersions.join(", ")}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <a
            href={inc.reference}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: MONO, fontSize: 13, color: MUTED }}
          >
            Advisory / post-mortem ↗
          </a>

          {/* How to check your own repo */}
          <div
            style={{
              marginTop: 34,
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: "20px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 600, color: BONE, letterSpacing: "-0.01em" }}>
              Check your repo
            </span>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: MUTED, margin: 0 }}>
              CodeTrawl matches your repo&rsquo;s declared dependencies against
              this list. Analyze a repo, then open its{" "}
              <strong style={{ color: BONE }}>Security</strong> tab — an exposure
              to this incident shows as a dated, cited finding. Matching is
              manifest-scoped: it catches a compromised{" "}
              <span style={{ fontFamily: MONO }}>name@version</span> you still
              declare.
            </p>
            <Link
              href="/#analyze"
              className="nav-cta"
              style={{ alignSelf: "flex-start" }}
            >
              Analyze a repo
            </Link>
          </div>
        </section>
      </main>

      <CTFooter />
    </CTSurface>
  );
}
