// POST /api/admin/bake-demo-ai — pre-generate the AI layer (repo briefing,
// health check, verdict bench statement) for a PUBLIC demo session and persist
// it onto the latest snapshot, so logged-out demo visitors READ pre-baked
// output and never trigger an Anthropic call on view.
//
// Why an admin endpoint: the auth DB + session store live on the Railway
// volume, and the normal generate routes are owner+tier gated — so there's no
// way to populate the demo sessions' AI fields from outside the container. This
// runs the generators directly (server-side) and patchLatestSnapshot()s the
// results. Run it once per demo (and again after a demo is refreshed).
//
// Scoped to DEMO_SESSIONS ids only — it can't be pointed at an arbitrary
// session to burn tokens. Security mirrors /api/admin/reset-billing: SHA-256
// timing-safe compare against a DEDICATED ADMIN_SECRET, 404 on any miss, inert
// until ADMIN_SECRET is set. POST only.

import { createHash, timingSafeEqual } from "node:crypto";
import { getSession, patchLatestSnapshot } from "@/lib/storage";
import { isDemoSession } from "@/lib/demoSessions";
import { generateRepoSummary } from "@/lib/aiSummary";
import { generateHealthAnalysis } from "@/lib/healthAnalysis";
import { computeVerdict } from "@/lib/intelligence/verdict";
import { generateVerdictNarrative } from "@/lib/intelligence/verdictNarrative";
import type { AnalysisSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tokenOk(provided: string | null): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  try {
    return timingSafeEqual(sha(provided), sha(expected));
  } catch {
    return false;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const authz = req.headers.get("authorization");
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!tokenOk(bearer ?? url.searchParams.get("token"))) return notFound();

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not set" },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = (
    body.sessionId ??
    url.searchParams.get("sessionId") ??
    ""
  ).trim();
  if (!sessionId) {
    return Response.json(
      { ok: false, error: "Provide a sessionId (JSON body or ?sessionId=)." },
      { status: 400 },
    );
  }
  // Guard: only the configured demo sessions can be baked — keeps this from
  // being pointed at an arbitrary session to spend tokens.
  if (!isDemoSession(sessionId)) {
    return Response.json(
      { ok: false, error: "Not a configured demo session." },
      { status: 400 },
    );
  }

  const session = await getSession(sessionId);
  if (!session) {
    return Response.json({ ok: false, error: "Session not found" }, { status: 404 });
  }
  const snap = session.snapshots[session.snapshots.length - 1];
  if (!snap) {
    return Response.json(
      { ok: false, error: "Session has no snapshots" },
      { status: 400 },
    );
  }

  const patch: Partial<AnalysisSnapshot> = {};
  const baked: string[] = [];
  const failed: { feature: string; error: string }[] = [];

  // AI briefing
  try {
    const summary = await generateRepoSummary(snap);
    if (summary) {
      patch.aiSummary = summary;
      baked.push("aiSummary");
    } else {
      failed.push({ feature: "aiSummary", error: "generator returned no content" });
    }
  } catch (err) {
    failed.push({ feature: "aiSummary", error: err instanceof Error ? err.message : "unknown" });
  }

  // Health check
  try {
    const health = await generateHealthAnalysis(snap);
    if (health) {
      patch.healthAnalysis = health;
      baked.push("healthAnalysis");
    } else {
      failed.push({ feature: "healthAnalysis", error: "generator returned no content" });
    }
  } catch (err) {
    failed.push({ feature: "healthAnalysis", error: err instanceof Error ? err.message : "unknown" });
  }

  // Verdict bench statement
  try {
    const verdict = computeVerdict(snap);
    const narrative = await generateVerdictNarrative(verdict, snap.repo.fullName);
    if (narrative) {
      patch.verdictNarrative = narrative;
      baked.push("verdictNarrative");
    } else {
      failed.push({ feature: "verdictNarrative", error: "generator returned no content" });
    }
  } catch (err) {
    failed.push({ feature: "verdictNarrative", error: err instanceof Error ? err.message : "unknown" });
  }

  if (baked.length > 0) {
    await patchLatestSnapshot(sessionId, patch);
  }

  console.log(
    `[admin/bake-demo-ai] ${sessionId} (${snap.repo.fullName}): baked [${baked.join(", ") || "none"}]` +
      (failed.length ? ` · failed [${failed.map((f) => f.feature).join(", ")}]` : ""),
  );

  return Response.json({
    ok: failed.length === 0,
    sessionId,
    repo: snap.repo.fullName,
    baked,
    failed,
  });
}
