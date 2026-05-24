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
import {
  requireSessionOwnership,
  requireSessionReadAccessFromRequest,
} from "@/lib/ownership";
import { getSession, deleteSession, renameSession } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // PUBLIC-repo sessions stay shareable — pasting a URL into any
  // browser should still render the analysis. PRIVATE-repo sessions
  // (v0.81+) are gated to the owner; non-owners get a 404 identical
  // to "session doesn't exist" so the URL leak doesn't disclose that
  // the session even exists.
  const denied = await requireSessionReadAccessFromRequest(session, req);
  if (denied) return denied;
  return NextResponse.json({ session });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await requireSessionOwnership(session, req);
  if (denied) return denied;
  await deleteSession(id);
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({ name: z.string().min(1).max(100) });

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await requireSessionOwnership(session, req);
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
