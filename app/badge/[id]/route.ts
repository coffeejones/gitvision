// GET /badge/[id] — the README trend badge (Arc 3 distribution).
//
// Returns an SVG of the session's verdict grade + trend arrow, sized for a
// README. No auth — the badge is meant to live in READMEs and be fetched by
// anyone (GitHub's image proxy strips cookies, so auth is not an option here).
//
// A private analysis and an id that has never existed get the SAME response,
// byte for byte. That is the whole security property of this route: it used to
// 404 a missing id while answering 200 "private" for a real one, which made it
// an existence oracle — anyone holding an id could confirm it was a real
// private analysis, and every other route in the product deliberately refuses
// to tell them that (checkSessionReadAccess returns 404). Returning the neutral
// badge for both keeps the feature the UI advertises (BadgeModal tells users a
// private repo's badge reads "private") while revealing nothing.

import { getSession } from "@/lib/storage";
import { isSessionPrivate } from "@/lib/ownership";
import { computeVerdict, verdictFor } from "@/lib/intelligence/verdict";
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

  // Missing and private are answered identically — same SVG, same cache
  // header — so the response carries no signal about whether the id is real.
  // Do not split these branches back apart to give a nicer 404: the two must
  // stay indistinguishable to anyone who did not create the analysis.
  if (!session || isSessionPrivate(session)) {
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
    const prev = verdictFor(snaps[snaps.length - 2]);
    const delta = curr.score - prev.score;
    trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  return svgResponse(gradeBadgeSvg({ grade: curr.grade, trend }), 600);
}
