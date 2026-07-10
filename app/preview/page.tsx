// /preview — the change-time blast preview (Arc 5, beat 1). Paste a PR URL and
// see what the diff touches BEFORE it merges: which load-bearing walls, how far
// it ripples, whether its tests were updated. Session-shaped — works on any
// public repo's PR, no CI install. Same CTSurface marketing shell as /agents.

import type { Metadata } from "next";
import Link from "next/link";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";
import { PreviewClient } from "@/components/preview/PreviewClient";

export const metadata: Metadata = {
  title: "Blast preview — what a PR touches before it merges | CodeTrawl",
  description:
    "Paste a GitHub PR and see what the diff reaches before it merges: the load-bearing files it touches, how far it ripples, and whether its tests were updated. Deterministic, pre-merge, no CI install.",
};

export default function PreviewPage() {
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
            <Link href="/agents">For agents</Link>
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
          <span className="eyebrow">Change-time blast · pre-merge</span>
          <h1>What does this PR touch?</h1>
          <p className="lede">
            Paste a GitHub pull request. Before it merges, see the load-bearing
            files the diff touches, how far the change ripples, and whether the
            tests that guard it were updated — deterministic, cited to the code
            graph, no CI install. Works on any public repo.
          </p>
        </header>

        <PreviewClient />
      </main>

      <CTFooter />
    </CTSurface>
  );
}
