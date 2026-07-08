// GET /badge/[id] — the README trend badge (Arc 3 distribution).
//
// Returns an SVG of the session's verdict grade + trend arrow, sized for a
// README. Public-repo sessions only: a private session returns a neutral
// "private" badge (never its grade), and a missing id 404s. No auth — the
// badge is meant to live in public READMEs and be fetched by anyone.

import { getSession } from "@/lib/storage";
import { isSessionPrivate } from "@/lib/ownership";
import { computeVerdict } from "@/lib/intelligence/verdict";
import { gradeBadgeSvg, neutralBadgeSvg, type BadgeTrend } from "@/lib/badge";

export const dynamic = "force-dynamic";

function svgResponse(svg: string, cacheSeconds: number): Response {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Cacheable so a README view doesn't recompute every time, but short
      // enough that the grade stays fresh — the whole point of the badge.
      "cache-control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`,
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);

  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  // Never expose a private repo's grade in a public README.
  if (isSessionPrivate(session)) {
    return svgResponse(neutralBadgeSvg("private"), 300);
  }

  const snaps = session.snapshots;
  const latest = snaps[snaps.length - 1];
  if (!latest) {
    return svgResponse(neutralBadgeSvg("pending"), 60);
  }

  const curr = computeVerdict(latest);

  // Trend vs the immediately-previous snapshot ("since last sweep"). Single-
  // snapshot sessions have no baseline, so no arrow.
  let trend: BadgeTrend = "none";
  if (snaps.length > 1) {
    const prev = computeVerdict(snaps[snaps.length - 2]);
    const delta = curr.score - prev.score;
    trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  return svgResponse(gradeBadgeSvg({ grade: curr.grade, trend }), 600);
}
