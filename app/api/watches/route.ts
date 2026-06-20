// /api/watches — manage the user's repo watches (re-sweep + regression
// alerts). You can only watch sessions you own. Gated behind the
// `watchedRepos` tier quota (Free 0 → Plus 5 → Pro unlimited), which is the
// Plus monetization lever for the feature.
//
//   GET    ?sessionId=X → { watching, watch }   (toggle state)
//   GET                  → { watches }           (the user's whole list)
//   POST   { sessionId } → { watch }             (start watching; 402 if gated)
//   DELETE { sessionId } → { ok }                (stop watching)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/storage";
import { requireSessionOwnership } from "@/lib/ownership";
import { getUserLimits } from "@/lib/billing/gates";
import {
  countWatchesForUser,
  createWatch,
  deleteWatchForSession,
  getWatchForSession,
  listWatchesForUser,
} from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function callerId(req: Request): Promise<string | null> {
  const s = await auth.api.getSession({ headers: req.headers });
  return s?.user?.id ?? null;
}

function bodySessionId(body: unknown): string | null {
  const v = (body as { sessionId?: unknown } | null)?.sessionId;
  return typeof v === "string" && v ? v : null;
}

export async function GET(req: Request): Promise<Response> {
  const userId = await callerId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (sessionId) {
    const watch = await getWatchForSession(userId, sessionId);
    return NextResponse.json({ watching: !!watch, watch: watch ?? null });
  }
  return NextResponse.json({ watches: await listWatchesForUser(userId) });
}

export async function POST(req: Request): Promise<Response> {
  const userId = await callerId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const sessionId = bodySessionId(await req.json().catch(() => null));
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // You can only watch your own sessions.
  const denied = await requireSessionOwnership(session, req);
  if (denied) return denied;

  // Idempotent — already watching → return it without spending quota.
  const existing = await getWatchForSession(userId, sessionId);
  if (existing) return NextResponse.json({ watch: existing });

  // Tier gate: watchedRepos = 0 (Free) / 5 (Plus) / -1 (Pro, unlimited).
  const cap = (await getUserLimits(userId)).watchedRepos;
  if (cap === 0) {
    return NextResponse.json(
      {
        error:
          "Watch is a Plus feature. Upgrade to monitor repos for regressions.",
        upgrade: true,
      },
      { status: 402 },
    );
  }
  if (cap !== -1 && (await countWatchesForUser(userId)) >= cap) {
    return NextResponse.json(
      {
        error: `You're watching the maximum of ${cap} repos on your plan. Upgrade for more.`,
        upgrade: true,
      },
      { status: 402 },
    );
  }

  const latest = session.snapshots[session.snapshots.length - 1];
  const repoFullName = latest?.repo.fullName ?? session.repoUrl;
  const watch = await createWatch({ userId, sessionId, repoFullName });
  return NextResponse.json({ watch });
}

export async function DELETE(req: Request): Promise<Response> {
  const userId = await callerId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const sessionId = bodySessionId(await req.json().catch(() => null));
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }
  await deleteWatchForSession(userId, sessionId);
  return NextResponse.json({ ok: true });
}
