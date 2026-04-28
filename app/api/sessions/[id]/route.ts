// GET    /api/sessions/[id]         — fetch full session
// DELETE /api/sessions/[id]         — delete session
// PATCH  /api/sessions/[id]         — rename session  { name }
//
// Ownership enforcement (v0.26+): mutating endpoints require the
// X-Owner-Id header to match the session's stored ownerId. Sessions
// without an ownerId (legacy, pre-v0.26) remain open to anyone.
// GET stays open so direct session URLs are still shareable.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Session } from "@/lib/types";
import { OWNER_ID_HEADER } from "@/lib/ownerId";
import { getSession, deleteSession, renameSession } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Common ownership check for mutating endpoints. Returns null when the
 *  caller is permitted; returns a Response (403/404) to short-circuit
 *  the handler when not. Sessions without ownerId are treated as legacy
 *  and accept any caller. */
function checkOwnership(session: Session, req: Request): Response | null {
  if (!session.ownerId) return null; // legacy ownerless session — open
  const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
  if (callerOwnerId === session.ownerId) return null;
  return NextResponse.json(
    {
      error:
        "This session belongs to a different browser. Open the original tab to modify it, or create a new analysis.",
    },
    { status: 403 }
  );
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // GET intentionally has no ownership check: pasting a session URL into
  // any browser should still render the analysis. Soft isolation only
  // hides sessions from the LANDING-PAGE list, not from direct access.
  return NextResponse.json({ session });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = checkOwnership(session, req);
  if (denied) return denied;
  await deleteSession(id);
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({ name: z.string().min(1).max(100) });

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = checkOwnership(session, req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const updated = await renameSession(id, parsed.data.name);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session: updated });
}
