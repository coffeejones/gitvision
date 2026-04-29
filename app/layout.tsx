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

export const metadata: Metadata = {
  title: "GitVision — map any GitHub repo",
  description:
    "Find what's risky, duplicated, or untested in any GitHub repo. Blast radius, structural duplicates, untested hotspots, and an AI health verdict — across 7 languages.",
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
