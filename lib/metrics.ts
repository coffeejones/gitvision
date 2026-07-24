// Founder metrics — aggregate, PII-free product numbers for the private
// admin tap (the token-gated /api/metrics endpoint, the CLI, and the weekly
// digest email all read this).
//
// Split into a PURE aggregator (aggregateMetrics — fully unit-testable on
// synthetic input) and a thin I/O wrapper (computeMetrics) that reads the two
// real sources: the auth DB (accounts + tiers) and file storage (analyses).
// The default output is counts only — no PII. computeMetrics({ detail: true })
// additionally returns recent signup emails + per-repo dates for the local
// admin dashboard; that PII-bearing variant is reached only through the
// token-gated endpoint + the dashboard's local proxy.
//
// Cheap enough to compute on demand at hobby scale; if the session count grows
// into the thousands the file scan in computeMetrics() is the thing to cache.

import { db } from "./db";
import * as schema from "./db/schema";
import { listSessions } from "./storage";
import { cmpStr } from "./deterministicSort";
import { simulateStats, type SimulateStats } from "./shadowGraph/simulateTelemetry";
import { gateInFlight } from "./shadowGraph/computeGate";
import { readActivation, type ActivationStatus } from "./opsStatus";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Internal tier id -> the display name users see (lib/pricing). Includes the
 *  legacy Scout/Knight/Baron ids so old rows bucket correctly. */
const TIER_LABEL: Record<string, string> = {
  "open-case": "Free",
  "standing-docket": "Plus",
  "full-bench": "Pro",
  // Legacy (RepoBaron-era) ids, still present on older accounts.
  scout: "Free",
  knight: "Plus",
  baron: "Pro",
};

/** Display labels that mean "paying customer". Counting by label (not by
 *  "not open-case") is robust to legacy + unknown tiers — an unknown id never
 *  inflates the paid count. */
const PAID_LABELS = new Set(["Plus", "Pro"]);

export interface MetricPair {
  total: number;
  thisWeek: number;
  prevWeek: number;
}

/** PII-bearing detail, only populated when computeMetrics({ detail: true }). */
export interface MetricsDetail {
  /** Recent signups, newest first (capped at 100). Contains email — PII. */
  accounts: { email: string; createdAt: string }[];
  /** Every analyzed repo with its count + last-analyzed date. Public data. */
  repos: { repo: string; count: number; lastAnalyzed: string }[];
}

/** Live Faultline / Shadow-Graph compute-engine timing — the data the deferred
 *  worker_thread offload decision rests on ("build it only if p95 drifts past
 *  ~1s under load", runPatch.ts). Process-live counters, not derived from the
 *  DB, so they reset on deploy — `startedAt` says how fresh the window is. */
export interface FaultlineMetrics extends SimulateStats {
  /** Simulates in flight through the compute gate right now. */
  inFlight: number;
  /** Process start (ISO). If it's minutes ago, the window is post-deploy fresh;
   *  if hours/days, the p95 reflects real accumulated traffic. */
  startedAt: string;
}

export interface Metrics {
  generatedAt: string;
  accounts: MetricPair & {
    /** tier != open-case */
    paid: number;
    /** display-name keyed: { Free, Plus, Pro } */
    byTier: Record<string, number>;
  };
  analyses: MetricPair & {
    uniqueRepos: number;
    /** total re-runs across all sessions (snapshots beyond the first) */
    refreshes: number;
  };
  /** Most-analyzed repos — doubles as marketing research. */
  topRepos: { repo: string; count: number }[];
  /** Last 30 calendar days, oldest-first, zero-filled (for sparklines). */
  signupsByDay: { day: string; count: number }[];
  analysesByDay: { day: string; count: number }[];
  /** ISO of the most recent signup / analysis ("last activity"). Null when
   *  none. Not PII — just a timestamp. */
  lastSignupAt: string | null;
  lastAnalysisAt: string | null;
  /** Live compute-engine timing. Present whenever computeMetrics() ran (it
   *  reads process state); omitted by pure aggregateMetrics() callers that
   *  don't inject it. */
  faultline?: FaultlineMetrics;
  /** Which env-gated features (Gate/Receipt, Watch cron, AI explainer) are
   *  wired on this box. Presence-only — never a secret value. Injected by
   *  computeMetrics(); omitted by pure callers. */
  activation?: ActivationStatus;
  /** Present only when detail was requested (carries emails — PII). */
  detail?: MetricsDetail;
}

interface UserRow {
  createdAtMs: number;
  tier: string;
  /** Only carried through when detail is requested. */
  email?: string;
}
interface SessionRow {
  createdAtMs: number;
  repoFullName: string;
  snapshotCount: number;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Zero-filled per-day counts for the last 30 days, oldest first. */
function byDay(items: { createdAtMs: number }[], nowMs: number) {
  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) buckets.set(dayKey(nowMs - i * DAY_MS), 0);
  for (const it of items) {
    const k = dayKey(it.createdAtMs);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return [...buckets].map(([day, count]) => ({ day, count }));
}

function pair(items: { createdAtMs: number }[], nowMs: number): MetricPair {
  const thisStart = nowMs - WEEK_MS;
  const prevStart = nowMs - 2 * WEEK_MS;
  let thisWeek = 0;
  let prevWeek = 0;
  for (const it of items) {
    if (it.createdAtMs >= thisStart) thisWeek++;
    else if (it.createdAtMs >= prevStart) prevWeek++;
  }
  return { total: items.length, thisWeek, prevWeek };
}

/** Pure aggregation — no I/O. `nowMs` is injected so tests are deterministic.
 *  With `detail`, also emits the recent-accounts (email) + per-repo-date lists. */
export function aggregateMetrics(
  users: UserRow[],
  sessions: SessionRow[],
  nowMs: number,
  opts: { detail?: boolean } = {},
  faultline?: FaultlineMetrics,
  activation?: ActivationStatus
): Metrics {
  const byTier: Record<string, number> = { Free: 0, Plus: 0, Pro: 0 };
  let paid = 0;
  let lastSignupMs = 0;
  for (const u of users) {
    const label = TIER_LABEL[u.tier] ?? u.tier;
    byTier[label] = (byTier[label] ?? 0) + 1;
    if (PAID_LABELS.has(label)) paid++;
    if (u.createdAtMs > lastSignupMs) lastSignupMs = u.createdAtMs;
  }

  // Per-repo: count + most-recent-analysis date.
  const repoAgg = new Map<string, { count: number; lastMs: number }>();
  let refreshes = 0;
  let lastAnalysisMs = 0;
  for (const s of sessions) {
    const r = repoAgg.get(s.repoFullName) ?? { count: 0, lastMs: 0 };
    r.count += 1;
    if (s.createdAtMs > r.lastMs) r.lastMs = s.createdAtMs;
    repoAgg.set(s.repoFullName, r);
    refreshes += Math.max(0, s.snapshotCount - 1);
    if (s.createdAtMs > lastAnalysisMs) lastAnalysisMs = s.createdAtMs;
  }
  const sortedRepos = [...repoAgg.entries()].sort(
    (a, b) => b[1].count - a[1].count || cmpStr(a[0], b[0])
  );
  const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null);

  const metrics: Metrics = {
    generatedAt: new Date(nowMs).toISOString(),
    accounts: { ...pair(users, nowMs), paid, byTier },
    analyses: {
      ...pair(sessions, nowMs),
      uniqueRepos: repoAgg.size,
      refreshes,
    },
    topRepos: sortedRepos.slice(0, 8).map(([repo, v]) => ({ repo, count: v.count })),
    signupsByDay: byDay(users, nowMs),
    analysesByDay: byDay(sessions, nowMs),
    lastSignupAt: iso(lastSignupMs),
    lastAnalysisAt: iso(lastAnalysisMs),
  };

  // Live engine timing + activation status are injected (not derived from
  // users/sessions), so the pure aggregator just passes them through — keeps it
  // testable with fixtures.
  if (faultline) metrics.faultline = faultline;
  if (activation) metrics.activation = activation;

  if (opts.detail) {
    metrics.detail = {
      accounts: [...users]
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 100)
        .map((u) => ({
          email: u.email ?? "(unknown)",
          createdAt: new Date(u.createdAtMs).toISOString(),
        })),
      repos: sortedRepos.map(([repo, v]) => ({
        repo,
        count: v.count,
        lastAnalyzed: new Date(v.lastMs).toISOString(),
      })),
    };
  }

  return metrics;
}

/** Read the real sources and aggregate. Server-only (touches the SQLite handle
 *  + the file store). PII-free output. */
export async function computeMetrics(
  opts: { detail?: boolean } = {}
): Promise<Metrics> {
  const userRows = db
    .select({
      createdAt: schema.user.createdAt,
      tier: schema.user.tier,
      email: schema.user.email,
    })
    .from(schema.user)
    .all();
  const users: UserRow[] = userRows.map((u) => ({
    createdAtMs: u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt),
    tier: u.tier,
    // Read but only surfaced in the output when detail is requested.
    email: u.email,
  }));

  // listSessions() already excludes PR-bot sessions (installationId set), so
  // this is user-initiated "repos analyzed" — the meaningful product number.
  const summaries = await listSessions();
  const sessions: SessionRow[] = summaries.map((s) => ({
    createdAtMs: new Date(s.createdAt).getTime(),
    repoFullName: s.repoFullName,
    snapshotCount: s.snapshotCount,
  }));

  // Live compute-engine timing from the same process (single Railway instance,
  // so the metrics route and the simulate route share this module state). The
  // rolling window is in-memory, so this is only meaningful on the prod box.
  const faultline: FaultlineMetrics = {
    ...simulateStats(),
    inFlight: gateInFlight(),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };

  return aggregateMetrics(users, sessions, Date.now(), opts, faultline, readActivation());
}
