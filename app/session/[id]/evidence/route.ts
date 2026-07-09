// GET /session/[id]/evidence — download the timestamped evidence pack as a zip
// (Arc 4, beat 4, Pro-only). Bundles the SBOMs + a machine-readable
// evidence.json + a human-readable SUMMARY.md. Same gating as SBOM export
// (sbomExport / Pro), with the demo bypass + private-repo read gate.

import { zipSync, strToU8 } from "fflate";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { collectEvidenceFiles, evidenceBaseName } from "@/lib/evidencePack/build";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return new Response("Not found", { status: 404 });

  if (!(await requireSessionReadAccess(session))) {
    return new Response("Not found", { status: 404 });
  }

  const authSession = await getAuthSession();
  const entitled =
    isDemoSession(id) ||
    (authSession ? await canAccess(authSession.user.id, "sbomExport") : false);
  if (!entitled) {
    return new Response("Evidence pack requires CodeTrawl Pro.", { status: 402 });
  }

  if (!session.snapshots[session.snapshots.length - 1]) {
    return new Response("This session has no snapshot to package.", { status: 409 });
  }

  const files = collectEvidenceFiles(session);
  const zipInput: Record<string, Uint8Array> = {};
  for (const f of files) zipInput[f.name] = strToU8(f.content);
  const zipped = zipSync(zipInput, { level: 6 });

  return new Response(zipped, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${evidenceBaseName(session)}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
