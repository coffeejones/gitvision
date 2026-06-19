// POST /api/sessions/[id]/health — generate (or regenerate) the health analysis
// for the latest snapshot. Result is stored on the snapshot so subsequent loads
// don't re-hit the Anthropic API.

import { NextResponse } from "next/server";
import { consumeAiBudget } from "@/lib/aiBudget";
import { requireAiInsights } from "@/lib/billing/aiGate";
import { requireSessionOwnership } from "@/lib/ownership";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { generateHealthAnalysis } from "@/lib/healthAnalysis";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 501 }
    );
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(`health:${ip}`, RATE_LIMITS.aiGenerate);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Try again in ${Math.ceil(
          retryAfterSec / 60
        )} minutes.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      }
    );
  }

  // Look up the session BEFORE consuming AI budget so a non-owner caller
  // never costs us anything. Same pattern as /summary.
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const denied = await requireSessionOwnership(session, req);
  if (denied) return denied;

  // Tier gate: the AI Health Check is a Plus feature (page hides it for Free;
  // enforce at the endpoint too).
  const tierDenied = await requireAiInsights(req);
  if (tierDenied) return tierDenied;

  const budget = consumeAiBudget();
  if (!budget.ok) {
    return NextResponse.json(
      {
        error:
          "AI features are paused for today (daily budget exhausted). Try again after UTC midnight.",
      },
      {
        status: 503,
        headers: { "X-AI-Budget-Reset": String(budget.resetAt) },
      }
    );
  }

  const snap = session.snapshots[session.snapshots.length - 1];
  if (!snap) {
    return NextResponse.json(
      { error: "Session has no snapshots" },
      { status: 400 }
    );
  }

  try {
    const result = await generateHealthAnalysis(snap);
    if (!result) {
      return NextResponse.json(
        { error: "Health analysis returned no content" },
        { status: 502 }
      );
    }
    const updated = await patchLatestSnapshot(id, { healthAnalysis: result });
    return NextResponse.json({ session: updated, analysis: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Health analysis failed: ${message}` },
      { status: 502 }
    );
  }
}
