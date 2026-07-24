// POST /api/cron/watch-monitor — the Watch monitor's trigger.
//
// A scheduler (Railway cron, cron-job.org, etc.) calls this on an interval; it
// re-sweeps watched repos whose head SHA moved and surfaces regression alerts.
// It runs in the Next.js server runtime on purpose: the monitor needs the full
// analysis pipeline, which a standalone `tsx` process can't resolve (the
// octokit umbrella pulls @octokit/app, which breaks Node-ESM resolution). So
// the cron is a simple authenticated curl, not a worker service.
//
// Security: shared CRON_SECRET (env), SHA-256 timing-safe compare, 404 on any
// miss — same model as /api/metrics. POST only.
//
// By default the work runs DETACHED via after() and the request returns 202
// immediately, so a run that sweeps many repos (minutes) never hits the HTTP
// timeout. ?wait=1 runs it synchronously and returns the result (manual
// testing); ?dry=1 inspects without writing.

import { after } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { recordWatchRun } from "@/lib/opsStatus";
import { deliverWatchAlerts, runWatchMonitor } from "@/lib/watchMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tokenOk(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  try {
    return timingSafeEqual(sha(provided), sha(expected));
  } catch {
    return false;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

async function runAndLog(dryRun: boolean) {
  const res = await runWatchMonitor({ dryRun });
  // Record real (non-dry) sweeps so the metrics tap can confirm the cron is
  // actually firing — a config check for CRON_SECRET + the Actions workflow.
  if (!dryRun) recordWatchRun(Date.now());
  console.log(
    `[watch-monitor] checked ${res.checked} · swept ${res.swept} · unchanged ${res.skippedUnchanged} · alerts ${res.alerts.length} · errors ${res.errors.length}`,
  );
  for (const a of res.alerts) {
    console.log(
      `  ALERT [${a.severity}] ${a.repoFullName}: ${a.summary} (session ${a.sessionId})`,
    );
  }
  for (const e of res.errors) {
    console.warn(`  ERROR watch ${e.watchId}: ${e.error}`);
  }

  // Deliver by email — real runs only (dry inspects without notifying).
  if (!dryRun && res.alerts.length > 0) {
    const d = await deliverWatchAlerts(res.alerts);
    console.log(
      `[watch-monitor] email: sent ${d.sent} · failed ${d.failed} · skipped ${d.skipped}`,
    );
  }

  return res;
}

export async function POST(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const authz = req.headers.get("authorization");
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!tokenOk(bearer ?? u.searchParams.get("token"))) return notFound();

  const dry = u.searchParams.get("dry") === "1";

  if (u.searchParams.get("wait") === "1") {
    const res = await runAndLog(dry);
    return Response.json(res, { headers: { "cache-control": "no-store" } });
  }

  // Detached: respond immediately, do the work after the response so a long
  // sweep run never trips the HTTP timeout.
  after(() => runAndLog(dry).catch((err) =>
    console.error("[watch-monitor] run failed:", err),
  ));
  return Response.json(
    { ok: true, scheduled: true },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
