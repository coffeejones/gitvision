// sitemap.xml (Next MetadataRoute, auto-served at /sitemap.xml).
//
// Lists the public, indexable routes only — marketing + legal. The app
// surface, API, and session URLs are deliberately excluded (they're
// login-walled or ephemeral) and are also disallowed in robots.ts.
//
// /agents, /exposure and /preview were missing here for as long as they have
// existed, while robots.txt allowed them the whole time — so three real public
// pages were crawlable in principle and undiscoverable in practice, with no
// inbound link either (see CTFooter). The per-incident pages matter most: each
// one answers "are we exposed to <named attack>?", they are statically
// generated from the same list that drives the analysis, and that is the query
// someone types the week an attack lands.

import type { MetadataRoute } from "next";
import { KNOWN_INCIDENTS } from "@/lib/security/knownIncidents";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://codetrawl.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const PRIORITIES: Record<string, number> = {
    "": 1,
    "/pricing": 0.8,
    "/agents": 0.7,
    "/exposure": 0.7,
    "/security": 0.7,
    "/help": 0.6,
    "/preview": 0.6,
  };
  const routes = [
    "",
    "/pricing",
    "/agents",
    "/exposure",
    "/security",
    "/help",
    "/preview",
    "/privacy",
    "/terms",
    "/cookies",
    "/refunds",
    // One page per curated incident — generated from the same source of truth
    // as app/exposure/[id]'s generateStaticParams, so adding an incident to
    // lib/security/knownIncidents.ts puts it in the sitemap automatically.
    ...KNOWN_INCIDENTS.map((incident) => `/exposure/${incident.id}`),
  ];
  return routes.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: PRIORITIES[path] ?? 0.5,
  }));
}
