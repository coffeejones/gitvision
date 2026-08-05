// POST /api/sessions/[id]/brief/[subject] — generate the reading for one brief.
//
// Same guards as the health analysis it is modelled on: ownership (not read
// access — this SPENDS money on the owner's behalf), the AI tier gate, and the
// daily budget. Cached onto the snapshot keyed by subject, so the three
// questions bill independently and a reader who only asks one pays for one.
//
// The deterministic brief is composed here rather than accepted from the
// client. A caller could otherwise post a brief with the gaps removed and get
// back a confident, clean-sounding paragraph about a repo nothing was checked
// on — which is precisely the failure the coverage work exists to prevent.

import { NextResponse } from "next/server";

import { consumeAiBudget } from "@/lib/aiBudget";
import { requireAiInsights } from "@/lib/billing/aiGate";
import { requireSessionOwnership } from "@/lib/ownership";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { buildBrief, isSubjectId } from "@/lib/brief";
import { generateBriefReading } from "@/lib/brief/reading";

type Ctx = { params: Promise<{ id: string; subject: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id, subject } = await ctx.params;

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isSubjectId(subject)) {
    return NextResponse.json({ error: "Unknown subject" }, { status: 404 });
  }

  const denied = await requireSessionOwnership(session, req);
  if (denied) return denied;

  const tierDenied = await requireAiInsights(req);
  if (tierDenied) return tierDenied;

  const budget = consumeAiBudget();
  if (!budget.ok) {
    return NextResponse.json(
      {
        error:
          "AI features are paused for today (daily budget exhausted). Try again after UTC midnight.",
      },
      { status: 503, headers: { "X-AI-Budget-Reset": String(budget.resetAt) } },
    );
  }

  const snapshots = session.snapshots ?? [];
  const snap = snapshots[snapshots.length - 1];
  if (!snap) {
    return NextResponse.json({ error: "Session has no snapshots" }, { status: 400 });
  }

  try {
    const brief = buildBrief(subject, snap, id);
    const reading = await generateBriefReading(brief, snap);
    if (!reading) {
      return NextResponse.json(
        { error: "The reading returned no usable content" },
        { status: 502 },
      );
    }
    // Merge rather than replace: the other two subjects' readings must survive.
    await patchLatestSnapshot(id, {
      briefReadings: { ...(snap.briefReadings ?? {}), [subject]: reading },
    });
    return NextResponse.json({ reading });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Reading failed: ${message}` }, { status: 502 });
  }
}
