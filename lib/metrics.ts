// Founder metrics — aggregate, PII-free product numbers for the private
// admin tap (the token-gated /api/metrics endpoint, the CLI, and the weekly
// digest email all read this).
//
// Split into a PURE aggregator (aggregateMetrics — fully unit-testable on
// synthetic input) and a thin I/O wrapper (computeMetrics) that reads the two
// real sources: the auth DB (accounts + tiers) and file storage (analyses).
// Nothing here returns emails, ids, or any per-user data — only counts.
//
// Cheap enough to compute on demand at hobby scale; if the session count grows
// into the thousands the file scan in computeMetrics() is the thing to cache.

import { db } from "./db";
import * as schema from "./db/schema";
import { listSessions } from "./storage";

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
}

interface UserRow {
  createdAtMs: number;
  tier: string;
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

/** Pure aggregation — no I/O. `nowMs` is injected so tests are deterministic. */
export function aggregateMetrics(
  users: UserRow[],
  sessions: SessionRow[],
  nowMs: number
): Metrics {
  const byTier: Record<string, number> = { Free: 0, Plus: 0, Pro: 0 };
  let paid = 0;
  for (const u of users) {
    const label = TIER_LABEL[u.tier] ?? u.tier;
    byTier[label] = (byTier[label] ?? 0) + 1;
    if (PAID_LABELS.has(label)) paid++;
  }

  const repoCounts = new Map<string, number>();
  let refreshes = 0;
  for (const s of sessions) {
    repoCounts.set(s.repoFullName, (repoCounts.get(s.repoFullName) ?? 0) + 1);
    refreshes += Math.max(0, s.snapshotCount - 1);
  }
  const topRepos = [...repoCounts]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
    .slice(0, 8);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    accounts: {
      ...pair(users, nowMs),
      paid,
      byTier,
    },
    analyses: {
      ...pair(sessions, nowMs),
      uniqueRepos: repoCounts.size,
      refreshes,
    },
    topRepos,
    signupsByDay: byDay(users, nowMs),
    analysesByDay: byDay(sessions, nowMs),
  };
}

/** Read the real sources and aggregate. Server-only (touches the SQLite handle
 *  + the file store). PII-free output. */
export async function computeMetrics(): Promise<Metrics> {
  const userRows = db
    .select({ createdAt: schema.user.createdAt, tier: schema.user.tier })
    .from(schema.user)
    .all();
  const users: UserRow[] = userRows.map((u) => ({
    createdAtMs: u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt),
    tier: u.tier,
  }));

  // listSessions() already excludes PR-bot sessions (installationId set), so
  // this is user-initiated "repos analyzed" — the meaningful product number.
  const summaries = await listSessions();
  const sessions: SessionRow[] = summaries.map((s) => ({
    createdAtMs: new Date(s.createdAt).getTime(),
    repoFullName: s.repoFullName,
    snapshotCount: s.snapshotCount,
  }));

  return aggregateMetrics(users, sessions, Date.now());
}
