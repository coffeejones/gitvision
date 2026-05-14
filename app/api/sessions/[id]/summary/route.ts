// POST /api/sessions/[id]/summary — generate (or regenerate) the AI summary for
// the latest snapshot. Summary is stored on the snapshot so subsequent loads
// don't re-hit the Anthropic API.

import { NextResponse } from "next/server";
import { consumeAiBudget } from "@/lib/aiBudget";
import { requireSessionOwnership } from "@/lib/ownership";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { generateRepoSummary } from "@/lib/aiSummary";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 501 }
    );
  }

  // Per-IP rate limit (cheap defense for casual abuse).
  const ip = getClientIp(req);
  const rl = checkRateLimit(`summary:${ip}`, RATE_LIMITS.aiGenerate);
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
  // never costs us anything. The previous order (budget first, ownership
  // never) was the audit-flagged hole — anyone with a session id could
  // drain the Anthropic quota.
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const denied = requireSessionOwnership(session, req);
  if (denied) return denied;

  // Daily AI budget kill-switch (global, ALL callers combined).
  // Layered with the Anthropic console spending cap as defense in depth.
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
    const result = await generateRepoSummary(snap);
    if (!result) {
      return NextResponse.json(
        { error: "Summary generator returned no content" },
        { status: 502 }
      );
    }
    const updated = await patchLatestSnapshot(id, { aiSummary: result });
    return NextResponse.json({ session: updated, summary: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Summary generation failed: ${message}` },
      { status: 502 }
    );
  }
}
