import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
// to /help shares with the GitVision brand image instead of a
// blank preview. The `metadataBase` makes relative og:image URLs
// resolve against the current host — important for Railway preview
// deploys where the URL changes per branch.
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitvision.net"
  ),
  title: "GitVision — map any GitHub repo",
  description:
    "Find what's risky, duplicated, or untested in any GitHub repo. Blast radius, structural duplicates, untested hotspots, and an AI health verdict — across 7 languages.",
  openGraph: {
    title: "GitVision — map any GitHub repo",
    description:
      "Blast radius, structural duplicates, untested hotspots, and an AI health verdict — across 7 languages. Paste a public GitHub URL to see your repo at a glance.",
    type: "website",
    siteName: "GitVision",
    // Auto-discovered by Next.js: app/opengraph-image.tsx generates
    // the image at /opengraph-image and sets og:image automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: "GitVision — map any GitHub repo",
    description:
      "Blast radius, structural duplicates, untested hotspots, and an AI health verdict — across 7 languages.",
    // Same convention: app/twitter-image.tsx populates twitter:image.
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Analytics is opt-in via env: set NEXT_PUBLIC_PLAUSIBLE_DOMAIN to the
  // domain you've configured in your Plausible dashboard (e.g. gitvision.app
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
        style={{ background: "var(--background)", color: "var(--foreground)" }}
      >
        {children}
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
