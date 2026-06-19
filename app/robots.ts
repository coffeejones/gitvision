// robots.txt (Next MetadataRoute, auto-served at /robots.txt).
//
// Allow the public marketing + legal surface; keep crawlers out of the
// app surface (login-walled anyway), the API, ephemeral session URLs, and
// the retired sandbox/mockup routes (which still carry stale RepoJury
// branding). Points at the sitemap so search engines find the canonical
// URL list.

import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://codetrawl.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/cases",
        "/pr-bot",
        "/news",
        "/how-it-works",
        "/account",
        "/session/",
        "/workspace",
        // Retired sandbox / preview / mockup routes.
        "/codetrawl",
        "/landing-v2",
        "/landing-v3",
        "/mockups",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
