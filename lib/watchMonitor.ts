// Watch monitor — the engine behind regression alerts. For each active watch:
//
//   1. Cheap change-detect: is the repo's head SHA different from the one we
//      last swept? (one light GitHub call). If not, skip — no waste.
//   2. Re-sweep the session's exact scope (same branch + subdir).
//   3. Diff the new verdict against the prior snapshot's (reusing diffVerdict).
//   4. If the move is an alert-worthy regression we haven't already alerted on,
//      emit a WatchAlert.
//
// This module COMPUTES alerts + persists watch state. Delivery (email) is a
// separate concern (the cron entry / a later batch) so detection stays pure
// and testable. `dryRun` skips all mutation (no snapshot append, no state
// write) so a run can be inspected safely.
//
// Server-only — pulls the analysis pipeline + db. Invoked from the cron
// entry script (scripts/run-watch-monitor.ts), never from a request handler.

import type { AnalysisSnapshot } from "./types";
import { analyzeRepo, parseRepoUrl } from "./github";
import { parseLayerWriter } from "./shadowGraph/persist";
import { getGithubTokenForUser } from "./githubUserToken";
import { getUpstreamHead } from "./freshness";
import { appendSnapshot, getSession } from "./storage";
import { computeVerdict } from "./intelligence/verdict";
import { diffVerdict, type VerdictDelta } from "./intelligence/verdictDelta";
import { computeRiskDrift, type RiskDrift } from "./riskDrift";
import { extractHealthSignals } from "./signals";
import {
  listActiveWatches,
  updateWatchState,
  type Watch,
} from "./watches";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { sendEmail } from "./email/send";
import { watchAlertEmail } from "./email/templates/watchAlert";

const LENS_LABEL: Record<string, string> = {
  health: "Health",
  security: "Security",
  forensics: "Forensics",
  supply: "Supply",
};

export interface WatchAlert {
  watchId: string;
  userId: string;
  sessionId: string;
  repoFullName: string;
  headSha: string;
  severity: "critical" | "regression";
  gradeFrom: string | null;
  gradeTo: string | null;
  scoreDelta: number;
  criticalDelta: number;
  lenses: string[];
  /** Files whose blast reach grew since the last sweep (Arc 3). Can trigger an
   *  alert on its own, even when the verdict grade held. Empty when none. */
  riskDrifts: RiskDrift[];
  /** One-line human summary, e.g. "B→C · +2 critical · Security regressed". */
  summary: string;
}

export interface WatchMonitorResult {
  checked: number;
  swept: number;
  skippedUnchanged: number;
  alerts: WatchAlert[];
  errors: { watchId: string; error: string }[];
}

/** High-severity finding count for a snapshot — same basis as the case-row
 *  critical count (lib/intelligence/cases.ts). */
function countCriticals(snap: AnalysisSnapshot): number {
  return extractHealthSignals(snap).needsWork.filter(
    (s) => s.severity === "high",
  ).length;
}

/** Decide whether a verdict move is worth an alert, and how loud. Only
 *  REGRESSIONS qualify; tiny score wobbles are filtered. New high-severity
 *  findings (a fresh secret / critical CVE / high signal) are "critical";
 *  a grade drop or a lens vote worsening is a "regression". */
export function assessRegression(
  delta: VerdictDelta,
): { worthy: boolean; severity: WatchAlert["severity"] } {
  if (delta.direction !== "regressed") {
    return { worthy: false, severity: "regression" };
  }
  if (delta.criticalDelta > 0) return { worthy: true, severity: "critical" };
  if (delta.grade || delta.departments.length > 0 || delta.scoreDelta <= -3) {
    return { worthy: true, severity: "regression" };
  }
  return { worthy: false, severity: "regression" };
}

/** Combine the verdict-regression assessment with risk drift into the final
 *  alert decision. Risk drift is an INDEPENDENT trigger — a growing blast radius
 *  alerts even when the verdict held. `verdictRegressed` reports whether the
 *  verdict itself worsened, so callers surface grade/lens copy ONLY on a real
 *  regression: a drift-only alert may accompany a grade that actually IMPROVED,
 *  and must not be framed as "dropped"/"regressed". */
export function assessWatch(
  delta: VerdictDelta,
  riskDrifts: RiskDrift[],
): { worthy: boolean; severity: WatchAlert["severity"]; verdictRegressed: boolean } {
  const v = assessRegression(delta);
  return {
    worthy: v.worthy || riskDrifts.length > 0,
    severity: v.worthy ? v.severity : "regression",
    verdictRegressed: v.worthy,
  };
}

function summarize(
  delta: VerdictDelta,
  lenses: string[],
  riskDrifts: RiskDrift[],
  verdictRegressed: boolean,
): string {
  const parts: string[] = [];
  // Verdict copy only when the verdict actually regressed — a drift-only alert
  // can accompany an IMPROVED grade, which must never read as a drop.
  if (verdictRegressed && delta.grade) parts.push(`${delta.grade.from}→${delta.grade.to}`);
  if (verdictRegressed && delta.criticalDelta > 0) parts.push(`+${delta.criticalDelta} critical`);
  if (lenses.length) parts.push(`${lenses.join(", ")} regressed`);
  if (riskDrifts.length) {
    parts.push(
      `${riskDrifts.length} file${riskDrifts.length === 1 ? "" : "s"}' blast grew`,
    );
  }
  // Only reachable on a verdict-only regression with no grade/lens/critical
  // move (e.g. a bare score wobble) — risk-drift alerts always add a part above.
  if (!parts.length) parts.push(`score ${delta.scoreDelta}`);
  return parts.join(" · ");
}

async function processWatch(
  watch: Watch,
  dryRun: boolean,
): Promise<{ swept: boolean; skipped: boolean; alert: WatchAlert | null }> {
  const session = await getSession(watch.sessionId);
  if (!session) {
    // The session was deleted out from under the watch — nothing to do.
    return { swept: false, skipped: true, alert: null };
  }
  const prev = session.snapshots[session.snapshots.length - 1];
  if (!prev) return { swept: false, skipped: true, alert: null };

  const parsed = parseRepoUrl(session.repoUrl);
  if (!parsed) return { swept: false, skipped: true, alert: null };

  const token = await getGithubTokenForUser(session.userId);
  const ref = prev.analyzedRef ?? null;

  // 1. Cheap change-detect.
  const head = await getUpstreamHead({
    sessionId: watch.sessionId,
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch: ref ?? prev.repo.defaultBranch,
    token: token ?? process.env.GITHUB_TOKEN ?? "",
  });
  if (!head) {
    // Couldn't read the head (rate limit / access) — leave state, try later.
    return { swept: false, skipped: true, alert: null };
  }
  if (head === watch.lastHeadSha) {
    // No new commits since the last sweep — skip the expensive part.
    if (!dryRun) await updateWatchState(watch.id, { lastSweptAt: new Date() });
    return { swept: false, skipped: true, alert: null };
  }

  // 2. Re-sweep the exact scope.
  const newSnap = await analyzeRepo(parsed.owner, parsed.repo, {
    ref,
    subdir: prev.analyzedSubdir ?? null,
    userToken: token,
    // Gate the cache write on !dryRun — a dry sweep is contractually
    // side-effect-free (no snapshot append, no state write), and the parse-cache
    // write + its fire-and-forget GC would otherwise mutate shared disk state
    // (and could evict a cold layer). analyzeRepo has no notion of dryRun, so the
    // gate belongs here alongside the other `if (!dryRun)` side effects.
    onParseLayer: dryRun
      ? undefined
      : parseLayerWriter({
          repo: `${parsed.owner}/${parsed.repo}`,
          ref: ref ?? undefined,
        }),
  });
  if (!dryRun) await appendSnapshot(watch.sessionId, newSnap);

  // 3. Diff verdicts.
  const delta = diffVerdict(
    computeVerdict(prev),
    computeVerdict(newSnap),
    countCriticals(prev),
    countCriticals(newSnap),
  );
  // 3b. Risk drift — files whose blast reach grew (Arc 3). An independent
  //     trigger: a file quietly becoming far more load-bearing is alert-worthy
  //     even when no department flipped its vote. Needs code graphs on both
  //     snapshots (regex-fallback-only langs / skipped analysis → empty).
  const riskDrifts =
    prev.codeGraph && newSnap.codeGraph
      ? computeRiskDrift(prev.codeGraph, newSnap.codeGraph)
      : [];

  const { worthy, severity, verdictRegressed } = assessWatch(delta, riskDrifts);

  // 4. Persist state. Only mark alerted (for dedup) when we actually alert on
  //    a head we haven't alerted on before.
  const alerting = worthy && head !== watch.lastAlertedSha;
  if (!dryRun) {
    await updateWatchState(watch.id, {
      lastSweptAt: new Date(),
      lastHeadSha: head,
      ...(alerting ? { lastAlertedSha: head } : {}),
    });
  }

  if (!alerting) return { swept: true, skipped: false, alert: null };

  // Only surface verdict-worsening copy (grade drop, worsened lenses, +critical)
  // when the verdict actually regressed. On a drift-only alert the grade may
  // have IMPROVED, so we null these out — otherwise the email would tell a user
  // their repo "dropped to A" while the grade went up.
  const lenses = verdictRegressed
    ? delta.departments.map((d) => LENS_LABEL[d.id] ?? d.id)
    : [];
  const alert: WatchAlert = {
    watchId: watch.id,
    userId: watch.userId,
    sessionId: watch.sessionId,
    repoFullName: watch.repoFullName,
    headSha: head,
    severity,
    gradeFrom: verdictRegressed ? (delta.grade?.from ?? null) : null,
    gradeTo: verdictRegressed ? (delta.grade?.to ?? null) : null,
    scoreDelta: delta.scoreDelta,
    criticalDelta: verdictRegressed ? delta.criticalDelta : 0,
    lenses,
    riskDrifts,
    summary: summarize(delta, lenses, riskDrifts, verdictRegressed),
  };
  return { swept: true, skipped: false, alert };
}

/** Run the monitor across every active watch. Returns the alerts produced
 *  (delivery is the caller's job). With `dryRun`, re-sweeps in memory but
 *  writes nothing — safe to inspect. */
export async function runWatchMonitor(
  opts: { dryRun?: boolean } = {},
): Promise<WatchMonitorResult> {
  const dryRun = !!opts.dryRun;
  const watches = await listActiveWatches();
  const result: WatchMonitorResult = {
    checked: watches.length,
    swept: 0,
    skippedUnchanged: 0,
    alerts: [],
    errors: [],
  };

  for (const watch of watches) {
    try {
      const { swept, skipped, alert } = await processWatch(watch, dryRun);
      if (swept) result.swept++;
      if (skipped) result.skippedUnchanged++;
      if (alert) result.alerts.push(alert);
    } catch (err) {
      result.errors.push({
        watchId: watch.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Deliver the alerts from a monitor run by email — one email per user,
 *  batching all of that user's regressions into a single message (a noisy
 *  day is one email, not ten). sendEmail never throws + no-ops cleanly when
 *  RESEND_API_KEY is unset, so this is safe to call unconditionally. */
export async function deliverWatchAlerts(
  alerts: WatchAlert[],
): Promise<{ sent: number; failed: number; skipped: number }> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (alerts.length === 0) return out;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://codetrawl.com";

  const byUser = new Map<string, WatchAlert[]>();
  for (const a of alerts) {
    const arr = byUser.get(a.userId);
    if (arr) arr.push(a);
    else byUser.set(a.userId, [a]);
  }

  for (const [userId, userAlerts] of byUser) {
    const rows = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    const email = rows[0]?.email;
    if (!email) {
      out.skipped++;
      continue;
    }
    const { subject, html, text } = watchAlertEmail({
      alerts: userAlerts,
      siteUrl,
    });
    const res = await sendEmail({ to: email, subject, html, text });
    if (res.ok) out.sent++;
    else out.failed++;
  }

  return out;
}
