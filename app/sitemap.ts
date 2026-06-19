// sitemap.xml (Next MetadataRoute, auto-served at /sitemap.xml).
//
// Lists the public, indexable routes only — marketing + legal. The app
// surface, API, and session URLs are deliberately excluded (they're
// login-walled or ephemeral) and are also disallowed in robots.ts.

import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://codetrawl.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const PRIORITIES: Record<string, number> = {
    "": 1,
    "/pricing": 0.8,
    "/help": 0.6,
  };
  const routes = [
    "",
    "/pricing",
    "/help",
    "/privacy",
    "/terms",
    "/cookies",
    "/refunds",
  ];
  return routes.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: PRIORITIES[path] ?? 0.5,
  }));
}
