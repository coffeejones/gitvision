// /exposure — the supply-chain incident tracker (Arc 4, beat 2). A public,
// evergreen list of curated named attacks; each links to a "check your
// exposure to X" detail page. Auto-grows: adding an incident to
// lib/security/knownIncidents.ts adds it here, so a new attack is live the
// moment it's curated. Same CTSurface marketing shell as /agents.

import type { Metadata } from "next";
import Link from "next/link";
import { ctMono } from "@/components/landing/codetrawl/ctFonts";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTNav } from "@/components/landing/codetrawl/CTNav";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";
import { KNOWN_INCIDENTS } from "@/lib/security/knownIncidents";
import { ECOSYSTEM_LABEL, formatIncidentDate } from "./format";

export const metadata: Metadata = {
  title: "Supply-chain incident tracker — check your exposure | CodeTrawl",
  description:
    "A curated, dated list of npm / PyPI / Cargo supply-chain attacks. Check whether any repo still ships a compromised package — grounded in the named incident, not a generic advisory.",
};

const MONO = ctMono.style.fontFamily;
const ORANGE = "#ff4f00";
const BONE = "#eceae8";
const MUTED = "rgba(255,255,255,0.58)";
const SURFACE = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.10)";

export default function ExposureIndexPage() {
  // Newest first — a tracker reads as a timeline.
  const incidents = [...KNOWN_INCIDENTS].sort((a, b) =>
    b.discoveredAt.localeCompare(a.discoveredAt),
  );

  return (
    <CTSurface>
      <CTNav />

      <main className="wrap" style={{ paddingBottom: 96 }}>
        <header
          className="price-hero"
          style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}
        >
          <span className="eyebrow">Supply-chain incident tracker</span>
          <h1>Are you still shipping a compromised package?</h1>
          <p className="lede">
            Named npm, PyPI, and Cargo attacks where a specific package version
            was confirmed malicious. CodeTrawl matches a repo&rsquo;s actual
            dependency tree against this curated list — so &ldquo;are we
            affected?&rdquo; gets a dated, cited answer instead of a shrug.
          </p>
        </header>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 760,
            margin: "64px auto 0",
          }}
        >
          {incidents.map((inc) => {
            const ecosystems = [
              ...new Set(inc.affectedPackages.map((p) => ECOSYSTEM_LABEL(p.ecosystem))),
            ];
            const pkgCount = new Set(inc.affectedPackages.map((p) => p.name)).size;
            return (
              <Link
                key={inc.id}
                href={`/exposure/${inc.id}`}
                style={{
                  display: "block",
                  textDecoration: "none",
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: "18px 20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 600, color: BONE, letterSpacing: "-0.01em" }}>
                    {inc.name}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: ORANGE }}>
                    {formatIncidentDate(inc.discoveredAt)}
                  </span>
                </div>
                <p style={{ fontSize: 14.5, lineHeight: 1.55, color: MUTED, margin: "8px 0 10px" }}>
                  {inc.shortDescription}
                </p>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: "rgba(255,255,255,0.42)" }}>
                    {pkgCount} package{pkgCount === 1 ? "" : "s"}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: "rgba(255,255,255,0.42)" }}>
                    {ecosystems.join(" · ")}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: BONE, marginLeft: "auto" }}>
                    Check exposure →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.42)",
            textAlign: "center",
            maxWidth: 620,
            margin: "44px auto 0",
            lineHeight: 1.6,
          }}
        >
          Curated from public advisories and post-mortems. Matching is
          manifest-scoped — it flags a compromised{" "}
          <span style={{ fontFamily: MONO }}>name@version</span> that a repo still
          declares; it can&rsquo;t see packages that entered off-manifest.
        </p>
      </main>

      <CTFooter />
    </CTSurface>
  );
}
