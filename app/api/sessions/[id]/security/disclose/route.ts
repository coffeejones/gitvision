// POST /api/sessions/[id]/security/disclose — the responsible-disclosure report
// for ONE reachable security finding.
//
// Body: { findingKey }. Returns { report, cached }.
//
// Simpler than the Source explainer: the finding is already in the snapshot, so
// there is no GitHub fetch, no drift check, and the only source transmitted to
// Anthropic is the one-line sink snippet the analysis already captured. The AI
// translates a finding the deterministic engine produced; it cannot introduce a
// new one (lib/security/disclosure keys every report to the finding it was
// handed).
//
// OWNERSHIP IS FIXED TO "third-party" HERE, and the client cannot override it.
// This is the structural gate discussed in scoping: codetrawl.com analyses
// public repos the caller does not own, so the hosted endpoint must be
// incapable of emitting a concrete payload for anyone's code. The "owned"
// calibration — a concrete PoC sketch — belongs to the desktop build, where by
// construction you are running your own uploaded project, or to a future
// verified-ownership signal. Not a request parameter.
//
// Gate stack (mirrors the explain route): AI configured → per-IP AI rate limit →
// session exists → read access (private-repo owner-only, 404 not 403) →
// entitlement (signed in) → the finding exists AND is reachable in this snapshot
// → cache (a hit costs no budget) → daily AI budget → generate.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { consumeAiBudget, peekAiBudget } from "@/lib/aiBudget";
import { classifySinks } from "@/lib/security/reachability";
import { generateDisclosure, findingKeyOf } from "@/lib/security/disclosure";
import {
  disclosureCacheKey,
  getCachedDisclosure,
  setCachedDisclosure,
} from "@/lib/security/disclosureCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  // 0. AI configured at all.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 501 });
  }

  // 1. Rate limit — this spends tokens, so use the AI-generation bucket.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`disclose:${ip}`, RATE_LIMITS.aiGenerate);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Rate limit reached. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // 2. Session must exist.
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 3. Read access — private-repo sessions are owner-only. 404, not 403.
  if (!(await requireSessionReadAccess(session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Entitlement: like the explainer, this is the one place that spends live
  //    Anthropic tokens per click, so it requires a (free) account even on a
  //    demo — bounding the anonymous denial-of-budget surface.
  const authSession = await getAuthSession();
  if (!authSession) {
    return NextResponse.json(
      { error: "Sign in to generate a disclosure report — it's free.", signIn: true },
      { status: 401 },
    );
  }

  const snap = session.snapshots[session.snapshots.length - 1];
  const cg = snap?.codeGraph;
  if (!snap || !cg) {
    return NextResponse.json(
      { error: "This snapshot has no analyzed code. Refresh to re-analyze." },
      { status: 404 },
    );
  }

  // 5. Parse the target finding key.
  let body: { findingKey?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const findingKey = typeof body.findingKey === "string" ? body.findingKey : "";
  if (!findingKey) {
    return NextResponse.json({ error: "Missing findingKey." }, { status: 400 });
  }

  // 6. The finding must EXIST in this snapshot and be REACHABLE. Re-classifying
  //    from the graph (rather than trusting the client) is what keeps the report
  //    anchored to a real deterministic finding — the client cannot ask for a
  //    report on a sink the engine did not produce, and a disclosure report only
  //    makes sense for something reachable.
  const finding = classifySinks(cg).findings.find(
    (f) => findingKeyOf(f) === findingKey,
  );
  if (!finding) {
    return NextResponse.json({ error: "No such finding in this snapshot." }, { status: 404 });
  }
  if (finding.reachability !== "reachable") {
    return NextResponse.json(
      { error: "A disclosure report is only generated for reachable findings." },
      { status: 422 },
    );
  }

  // Hosted endpoint: always the conservative calibration. See the header.
  const ownership = "third-party" as const;

  // 7. Read-through cache — a hit costs no AI budget. Keyed by the analyzed file
  //    hash so a re-sweep that edits the sink's file misses and regenerates.
  const fileHash = cg.contentHashes?.[finding.filePath] ?? "nohash";
  const cacheKey = disclosureCacheKey({ sessionId: id, findingKey, ownership, fileHash });
  const cached = getCachedDisclosure(cacheKey);
  if (cached) return NextResponse.json({ report: cached, cached: true });

  // 8. Peek the budget before anything else — the shared daily kill-switch.
  if (!peekAiBudget().ok) {
    return NextResponse.json(
      { error: "AI features are paused for today (daily budget exhausted). Try again after UTC midnight." },
      { status: 503, headers: { "X-AI-Budget-Reset": String(peekAiBudget().resetAt) } },
    );
  }

  // 9. Consume the budget now, immediately before the Anthropic call.
  const budget = consumeAiBudget();
  if (!budget.ok) {
    return NextResponse.json(
      { error: "AI features are paused for today (daily budget exhausted). Try again after UTC midnight." },
      { status: 503, headers: { "X-AI-Budget-Reset": String(budget.resetAt) } },
    );
  }

  // 10. Generate. The finding's snippet is discarded with the request — only the
  //     report (a translation of a finding we already had) is kept, in memory.
  try {
    const report = await generateDisclosure(finding, ownership);
    if (!report) {
      return NextResponse.json({ error: "The disclosure generator returned no content." }, { status: 502 });
    }
    setCachedDisclosure(cacheKey, report);
    return NextResponse.json({ report, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Disclosure generation failed: ${message}` }, { status: 502 });
  }
}
