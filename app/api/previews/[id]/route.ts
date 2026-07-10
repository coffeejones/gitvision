// GET /api/previews/[id] — fetch a stored change-blast preview (Arc 5). The id
// is an unguessable nanoid handed back via the job's previewId; no auth in v1
// (the preview is over a public PR and the id is the only handle).

import { NextResponse } from "next/server";
import { getPreview } from "@/lib/previewStore";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const preview = await getPreview(id);
  if (!preview) {
    return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  }
  return NextResponse.json(preview);
}
