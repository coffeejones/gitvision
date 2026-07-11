// POST /api/sessions/[id]/simulate — the web "Faultline" surface for the
// Shadow-Graph patcher. Given a proposed diff (whole-file changes), splice it
// into the session's cached parse layer, rebuild the graph, and return the blast
// verdict + required actions. Read-only: no snapshot is appended.
//
// Gate stack (in order): per-IP rate limit → session exists → read access
// (private sessions owner-only) → `simulate` entitlement (Plus; demo sessions
// bypass) → body validation → run. The compute is bounded by the patch DoS gate
// (per-file + cumulative byte caps) inside runSimulateForSession.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { parseSimulateChanges } from "@/lib/shadowGraph/validateChanges";
import { runSimulateForSession } from "@/lib/shadowGraph/simulateSession";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  // 1. Rate limit — bound the synchronous parse burst per IP.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`simulate:${ip}`, RATE_LIMITS.sessionSimulate);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Try again in ${Math.ceil(
          retryAfterSec / 60,
        )} minutes.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      },
    );
  }

  // 2. Session must exist.
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 3. Read access — private-repo sessions are owner-only, same as the pages.
  //    404 (not 403) so we don't confirm a private session exists to a stranger.
  if (!(await requireSessionReadAccess(session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Entitlement — simulate is Plus. Demo sessions bypass so the public demo
  //    can showcase the Faultline surface without an account.
  const authSession = await getAuthSession();
  const entitled =
    isDemoSession(id) ||
    (authSession ? await canAccess(authSession.user.id, "simulate") : false);
  if (!entitled) {
    return NextResponse.json(
      { error: "Change simulation requires CodeTrawl Plus.", upgrade: true },
      { status: 402 },
    );
  }

  // 5. Validate the proposed diff. Reject an oversized body by its declared
  //    length BEFORE buffering + JSON-parsing it — the patch byte caps only
  //    reject after the parse, so this is the ingestion-side guard. 1 MB is well
  //    above the 512 KB cumulative change cap the patch gate enforces.
  const MAX_BODY_BYTES = 1_000_000;
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  const body = await req.json().catch(() => null);
  const parsed = parseSimulateChanges(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // 6. Simulate against the latest snapshot.
  const snapshot = session.snapshots[session.snapshots.length - 1];
  if (!snapshot) {
    return NextResponse.json(
      { error: "This session has no snapshot yet — refresh it first." },
      { status: 409 },
    );
  }

  // 7. A typed "can't simulate this session" outcome (no code graph, evicted
  //    parse layer, or a repo too large for interactive simulation) is a
  //    legitimate 200 the UI renders as a re-analyze / too-large prompt — not a
  //    server error.
  const out = await runSimulateForSession(snapshot, parsed.changes);
  if (!out.ok) {
    return NextResponse.json({ ok: false, reason: out.reason, message: out.message });
  }
  // `simulated` is the discriminator a consumer must key on. A non-patched mode
  // (config edit → needs-full-analysis, too-large, base drift) carries no report
  // and an empty requiredActions list — without this flag a naive client could
  // misread it as a "clear" verdict. false = not a pass; re-analyze for an exact
  // answer.
  return NextResponse.json({
    ok: true,
    simulated: out.result.mode === "patched",
    result: out.result,
  });
}
