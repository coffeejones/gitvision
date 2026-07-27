import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Site-wide metadata. Per-page exports (in app/help/page.tsx,
// app/legal/page.tsx, etc.) override title + description but
// inherit OpenGraph + Twitter card config from here, so a deep-link
// to /help shares with the CodeTrawl brand image instead of a
// blank preview. The `metadataBase` makes relative og:image URLs
// resolve against the current host — important for Railway preview
// deploys where the URL changes per branch.
//
// This is NOT just the fallback for a few stray routes: no page under
// app/session/[id]/ declares metadata of its own, so EVERY analysis URL —
// including the three public demos the landing offers as its only proof —
// shares with whatever is written here. It carried the retired "map any GitHub
// repo" pitch for months after the product stopped being described that way,
// which meant the most-shared surface pitched the old product. Keep this in
// step with app/page.tsx's TITLE/DESCRIPTION when the positioning moves.
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://codetrawl.com"
  ),
  title: "CodeTrawl — get to know any codebase",
  description:
    "Paste a GitHub repo and read it like a manual — what every part does, how it all connects, and what breaks if you touch it. One sweep, about a minute, nothing to install.",
  openGraph: {
    title: "CodeTrawl — get to know any codebase",
    description:
      "Paste a GitHub repo and read it like a manual — what every part does, how it all connects, and what breaks if you touch it. One sweep, about a minute, nothing to install.",
    type: "website",
    siteName: "CodeTrawl",
    // Auto-discovered by Next.js: app/opengraph-image.tsx generates
    // the image at /opengraph-image and sets og:image automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: "CodeTrawl — get to know any codebase",
    description:
      "Paste a GitHub repo and read it like a manual — what every part does, how it all connects, and what breaks if you touch it.",
    // No app/twitter-image.tsx: when an OG image exists and twitter.images
    // is unset, Next.js reuses app/opengraph-image.tsx for twitter:image, so
    // the summary_large_image card still renders the CodeTrawl share image.
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Analytics is opt-in via env: set NEXT_PUBLIC_PLAUSIBLE_DOMAIN to the
  // domain you've configured in your Plausible dashboard (e.g. codetrawl.com
  // or a self-hosted equivalent). Unset → no analytics, no script tag, no
  // tracking. Keeps the local-dev experience analytics-free without code
  // changes.
  //
  // We chose Plausible because:
  //   - Cookie-free, IP-anonymized — no GDPR consent banner needed.
  //   - Lightweight (~1 KB script).
  //   - Self-hostable if we ever care to.
  //   - Captures only aggregate pageviews/referrers — no session replay,
  //     no fingerprinting, no individual-user tracking. Matches what we
  //     promise on the /legal page.
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        // Background comes from CSS (globals.css `body`), NOT an inline style —
        // an inline bg beats every stylesheet rule, which blocked the
        // `body:has(.ct)` bitumen override and left a cool band on the landing's
        // overscroll bounce. Colour stays inline (no per-surface override).
        style={{ color: "var(--foreground)" }}
      >
        {children}
        <CookieConsentBanner />
        {plausibleDomain && (
          <Script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.js"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
