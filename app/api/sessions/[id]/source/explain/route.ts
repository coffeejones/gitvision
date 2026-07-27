// POST /api/sessions/[id]/source/explain — the source-aware, signal-grounded AI
// explanation for ONE function in the Source view.
//
// Body: { path, fn, line }. Returns { signals, explanation, cached }.
//
// This is the one endpoint that transmits repository source to Anthropic — one
// function at a time, on the user's explicit click. It is never stored: the
// explanation is held only in an in-memory read-through cache (keyed by the
// analyzed commit, so a re-sweep invalidates it). Both callers — the Source
// view and the Flows diagram — disclose the transmission at the point of
// action, and both ask a private-repo reader to opt in first (lib/explainConsent).
//
// That opt-in is a CLIENT-SIDE consent prompt, not a gate this route enforces:
// the checks below establish who is asking, never that they were asked. Said
// plainly because the previous version of this comment implied the Source view
// was the only caller, which is how Flows shipped without the prompt at all.
//
// Gate stack (in order): AI configured → per-IP AI rate limit → session exists →
// read access (private-repo owner-only, 404 not 403) → free-phase entitlement
// (signed in OR a demo) → path is an analyzed file → the function exists at that
// line → cache (a hit costs no budget and no GitHub call) → daily AI budget →
// fetch source pinned to analyzedRef + integrity check → slice the function →
// ground + explain. Grounded-frame invariant lives in lib/functionExplain.ts.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { isSafeRelPath } from "@/lib/shadowGraph/validateChanges";
import { getGithubTokenForUser } from "@/lib/githubUserToken";
import { makeOctokit } from "@/lib/github";
import { consumeAiBudget, peekAiBudget } from "@/lib/aiBudget";
import {
  fetchFileSource,
  isAligned,
  extOf,
  type SourceOctokit,
  type FetchSourceError,
} from "@/lib/sourceView";
import {
  functionMarkersFor,
  duplicateIndex,
  callerIndex,
  computeFileChips,
} from "@/lib/sourceAnnotations";
import {
  explainFunction,
  buildFunctionSignals,
  sliceFunctionSource,
} from "@/lib/functionExplain";
import {
  explainCacheKey,
  getCachedExplanation,
  setCachedExplanation,
} from "@/lib/functionExplainCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const FETCH_ERROR: Record<FetchSourceError, { status: number; message: string }> = {
  "not-a-file": { status: 400, message: "That path isn't a file." },
  "too-large": { status: 413, message: "This file is too large to explain." },
  "not-found": {
    status: 404,
    message:
      "File not found at the analyzed commit — refresh the session to re-analyze.",
  },
  forbidden: {
    status: 502,
    message: "GitHub declined the request (rate limit or access). Try again shortly.",
  },
};

export async function POST(req: Request, ctx: Ctx) {
  // 0. AI configured at all.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 501 });
  }

  // 1. Rate limit — this spends tokens + makes a live GitHub call, so use the
  //    tighter AI-generation bucket, not the source-view bucket.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`explain:${ip}`, RATE_LIMITS.aiGenerate);
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

  // 4. Free-phase entitlement: the explainer is free, but it requires a (free)
  //    account — even on a demo session, unlike the read-only Source view. This
  //    is the one endpoint that spends live Anthropic tokens per click, so it
  //    upholds the codebase invariant that AI is never generated live on an
  //    anonymous demo view (the briefing/health are pre-baked), and bounds the
  //    anonymous denial-of-budget surface. Logged-out demo viewers still see the
  //    whole deterministic layer (chips, markers); only the AI narration signs
  //    in. The account also gates the token budget against anonymous abuse.
  const authSession = await getAuthSession();
  if (!authSession) {
    return NextResponse.json(
      { error: "Sign in to read this with AI — it's free.", signIn: true },
      { status: 401 },
    );
  }

  const snap = session.snapshots[session.snapshots.length - 1];
  const cg = snap?.codeGraph;
  if (!snap || !cg?.contentHashes) {
    return NextResponse.json(
      { error: "This snapshot has no analyzed files. Refresh to re-analyze." },
      { status: 404 },
    );
  }

  // 5. Parse + validate the target.
  let body: { path?: unknown; fn?: unknown; line?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path : "";
  const fnName = typeof body.fn === "string" ? body.fn : "";
  const line = typeof body.line === "number" ? body.line : NaN;
  if (!isSafeRelPath(path)) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }
  if (cg.contentHashes[path] === undefined) {
    return NextResponse.json({ error: "Not an analyzed file in this snapshot." }, { status: 404 });
  }

  // 6. Locate the function — its enriched marker (changed / duplicates / callers)
  //    is what grounds the explanation. Match on name AND line so same-named
  //    functions in one file don't collide.
  const prevCg = session.snapshots[session.snapshots.length - 2]?.codeGraph ?? null;
  const markers = functionMarkersFor(cg, path, prevCg, duplicateIndex(cg), callerIndex(cg));
  const marker = markers.find((m) => m.startRow + 1 === line && (!fnName || m.name === fnName));
  if (!marker) {
    return NextResponse.json(
      { error: "No analyzed function at that line." },
      { status: 404 },
    );
  }

  // 7. Ground: the function's flat signal set (marker + its file's chips). Cheap
  //    to recompute, and we always return it so the panel shows exactly what the
  //    model was given — the grounding is visible, not hidden.
  const chips = computeFileChips(snap)[path] ?? null;
  const signals = buildFunctionSignals(path, marker, chips);

  // 8. Read-through cache — a hit costs no AI budget and no GitHub call. Keyed by
  //    the analyzed file fingerprint + the signals digest, so it's drift-proof:
  //    a re-sweep that changes the file (or its fan-in) misses and re-explains.
  const ref = snap.analyzedRef || snap.repo.defaultBranch;
  const cacheKey = explainCacheKey({
    sessionId: id,
    path,
    line,
    fileHash: cg.contentHashes[path],
    signals,
  });
  const cached = getCachedExplanation(cacheKey);
  if (cached) {
    return NextResponse.json({ signals, explanation: cached, cached: true });
  }

  // 9. Peek the daily AI budget BEFORE the GitHub fetch — if AI is already paused
  //    for the day, skip the fetch and don't touch the counter. The counter is a
  //    shared global kill-switch (summary + health + explain), so spending it on
  //    a request that later 4xx's (bad token, fetch error, drift) would let a
  //    drift-spam attack drain everyone's budget. We consume it only at step 12,
  //    immediately before the Anthropic call.
  if (!peekAiBudget().ok) {
    return NextResponse.json(
      { error: "AI features are paused for today (daily budget exhausted). Try again after UTC midnight." },
      { status: 503, headers: { "X-AI-Budget-Reset": String(peekAiBudget().resetAt) } },
    );
  }

  // 10. Token: the owner's for a private repo (read access proved ownership),
  //     the shared server token for a public repo.
  const repoPrivate = snap.repo.private === true;
  let token: string | null | undefined = process.env.GITHUB_TOKEN;
  if (repoPrivate && authSession) {
    token = await getGithubTokenForUser(authSession.user.id);
    if (!token) {
      return NextResponse.json(
        { error: "Reconnect your GitHub account to explain private-repo source.", reconnect: true },
        { status: 403 },
      );
    }
  }

  // 11. Fetch the file, pinned to the analyzed commit, and prove integrity. If it
  //     drifted, the function's line span may be wrong — refuse rather than
  //     explain stale source under the wrong signals.
  const octokit = makeOctokit(token) as unknown as SourceOctokit;
  const result = await fetchFileSource(octokit, {
    owner: snap.repo.owner,
    repo: snap.repo.name,
    path,
    ref,
  });
  if (!result.ok) {
    const e = FETCH_ERROR[result.error];
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (!isAligned(result.content, cg.contentHashes[path])) {
    return NextResponse.json(
      {
        error:
          "This file changed since we analyzed it — refresh the session to re-align before explaining.",
        drifted: true,
      },
      { status: 409 },
    );
  }

  // 12. Consume the daily AI budget now — aligned source in hand, about to call
  //     Anthropic. Re-check for the peek→consume race (another request could
  //     have taken the last unit meanwhile).
  const budget = consumeAiBudget();
  if (!budget.ok) {
    return NextResponse.json(
      { error: "AI features are paused for today (daily budget exhausted). Try again after UTC midnight." },
      { status: 503, headers: { "X-AI-Budget-Reset": String(budget.resetAt) } },
    );
  }

  // 13. Slice the function, ground it, explain it, cache it. Source is discarded
  //     with the request — only the explanation (a finding) is kept, in memory.
  const source = sliceFunctionSource(result.content, marker);
  try {
    const explanation = await explainFunction(source, signals, extOf(path));
    if (!explanation) {
      return NextResponse.json({ error: "The explainer returned no content." }, { status: 502 });
    }
    setCachedExplanation(cacheKey, explanation);
    return NextResponse.json({ signals, explanation, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Explanation failed: ${message}` }, { status: 502 });
  }
}
