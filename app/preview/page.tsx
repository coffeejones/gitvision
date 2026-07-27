// /preview — the change-time blast preview (Arc 5, beat 1). Paste a PR URL and
// see what the diff touches BEFORE it merges: which load-bearing walls, how far
// it ripples, whether its tests were updated. Session-shaped — works on any
// public repo's PR, no CI install. Same CTSurface marketing shell as /agents.

import type { Metadata } from "next";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTNav } from "@/components/landing/codetrawl/CTNav";
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
      <CTNav />

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
