// GET /session/[id]/sbom?format=cyclonedx|spdx — download a timestamped SBOM
// for the session's latest snapshot (Arc 4, Pro-only). Reuses the read-access
// gate (private-repo sessions are owner-only) and the Pro entitlement check;
// demo sessions bypass the paywall so the public demo can show the download.

import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { generateSbom, type SbomFormat } from "@/lib/sbom";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return new Response("Not found", { status: 404 });

  // Private-repo sessions are owner-only — same gate as the session pages.
  if (!(await requireSessionReadAccess(session))) {
    return new Response("Not found", { status: 404 });
  }

  // Pro entitlement (demo sessions bypass to showcase the feature).
  const authSession = await getAuthSession();
  const entitled =
    isDemoSession(id) ||
    (authSession ? await canAccess(authSession.user.id, "sbomExport") : false);
  if (!entitled) {
    return new Response("SBOM export requires CodeTrawl Pro.", { status: 402 });
  }

  const format: SbomFormat =
    new URL(req.url).searchParams.get("format") === "spdx"
      ? "spdx"
      : "cyclonedx";

  const current = session.snapshots[session.snapshots.length - 1];
  const sbom = current ? generateSbom(current, format) : null;
  if (!sbom) {
    return new Response(
      "No components captured on this snapshot yet — refresh the session to generate an SBOM.",
      { status: 409 },
    );
  }

  return new Response(sbom.body, {
    headers: {
      "content-type": sbom.contentType,
      "content-disposition": `attachment; filename="${sbom.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
