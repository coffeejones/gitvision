// Who touched this file?
//
// The pipeline records two different answers and they are not interchangeable.
// `FileHotspot.authorLogins` holds GITHUB LOGINS, and only those: the UI turns
// each one into a https://github.com/<login> link, so a display name in that
// array produces a broken URL. But a login is only recoverable when the commit
// was authored from a `users.noreply.github.com` address — which is a minority
// of real commits.
//
// The consequence, measured across the stored snapshots: login resolution runs
// 100% on flask and zod, 82% on gin, 45% on rspec, 26% on spring-petclinic,
// 21% on serilog — and **0% on four repos**, including this one. On those,
// every author-derived answer collapsed: `authors` counted zero, so the whole
// Team dimension went dark.
//
// `commitIndex` has what's missing. Each entry carries `a` (the login, often
// null) AND `n` (the author name, always present — the type comment has
// anticipated this use since it was written). Resolving identity at READ time
// means old snapshots on disk are fixed too, with no re-sweep.

import type { AnalysisSnapshot, FileHotspot } from "./types";
import { cmpStr } from "./deterministicSort";

/** Canonical identity per commit SHA, for one snapshot. Built once and reused —
 *  a repo with 5,000 commits shouldn't rebuild this per hotspot. */
export interface AuthorIndex {
  /** SHA → canonical identity (a GitHub login where one is known, else the
   *  author's name). */
  bySha: Map<string, string>;
  /** True when the index carries anything at all. */
  hasData: boolean;
  /** Identities that are real GitHub logins, so prose can say "@name" only
   *  when that would actually resolve to a profile. */
  logins: Set<string>;
}

/** Build the SHA → identity map for a snapshot.
 *
 *  One person often appears twice — as a login on commits pushed through the
 *  GitHub web UI and as a plain name on commits pushed from a laptop. Any name
 *  that is ever seen alongside a login is folded into that login, so the same
 *  human counts once. Without that fold, a solo developer can read as two
 *  authors and quietly defuse the bus-factor signal. */
export function buildAuthorIndex(snap: AnalysisSnapshot): AuthorIndex {
  const bySha = new Map<string, string>();
  const logins = new Set<string>();
  const index = snap.commitIndex;
  if (!index) return { bySha, hasData: false, logins };

  const nameToLogin = new Map<string, string>();
  for (const entry of Object.values(index)) {
    if (entry.a && entry.n && !nameToLogin.has(entry.n)) {
      nameToLogin.set(entry.n, entry.a);
    }
  }

  for (const [sha, entry] of Object.entries(index)) {
    const identity = entry.a ?? (entry.n ? nameToLogin.get(entry.n) ?? entry.n : null);
    if (identity) {
      bySha.set(sha, identity);
      if (entry.a === identity) logins.add(identity);
    }
  }
  return { bySha, hasData: bySha.size > 0, logins };
}

/** Commits per identity, most prolific first.
 *
 *  SHARE, not distinct-count, is the honest way to ask "is this one person's
 *  project?". Counting strings breaks the moment somebody commits from two
 *  machines with different git configs — this repo records both "Jonas Hansen"
 *  and "jonas", serilog both "Nicholas Blumhardt" and "nblumhardt". Folding
 *  those by name similarity would be guessing at identity, which is the one
 *  thing this codebase refuses to do. Share sidesteps it: Jonas Hansen holds
 *  98% here whether or not the 1% stray is the same human. */
export function authorCommitShares(
  snap: AnalysisSnapshot,
  opts: { exclude?: (identity: string) => boolean } = {},
  index?: AuthorIndex
): { identity: string; commits: number; sharePct: number }[] {
  const idx = index ?? buildAuthorIndex(snap);
  if (!idx.hasData) return [];
  const counts = new Map<string, number>();
  for (const identity of idx.bySha.values()) {
    // Exclusions are applied BEFORE the percentages, not after. Filtering the
    // resulting list instead would leave every share computed against a total
    // that includes the excluded commits — a repo split 50/50 between one human
    // and dependabot would report that human at 50%, hiding a solo project.
    if (opts.exclude?.(identity)) continue;
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((n, v) => n + v, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([identity, commits]) => ({
      identity,
      commits,
      sharePct: Math.round((commits / total) * 100),
    }))
    .sort((a, b) => b.commits - a.commits || cmpStr(a.identity, b.identity));
}

/** The distinct people who touched this file.
 *
 *  Prefers the commit index, because it can see authors that never resolved to
 *  a GitHub account. Falls back to `authorLogins` for snapshots taken through
 *  the REST path, which records no names at all. */
export function resolveHotspotAuthors(
  hotspot: FileHotspot,
  index: AuthorIndex
): string[] {
  if (index.hasData) {
    const out = new Set<string>();
    for (const sha of hotspot.commits ?? []) {
      const who = index.bySha.get(sha);
      if (who) out.add(who);
    }
    if (out.size > 0) return [...out];
  }
  return [...new Set(hotspot.authorLogins ?? [])];
}

/** Distinct people across the whole snapshot, for project-level questions
 *  ("is this a solo project?") that shouldn't depend on login resolution
 *  either. Returns null when there's nothing to count, so callers can tell
 *  "no data" from "genuinely one person". */
export function resolveProjectAuthors(snap: AnalysisSnapshot): string[] | null {
  const index = buildAuthorIndex(snap);
  if (index.hasData) return [...new Set(index.bySha.values())];
  const fromHotspots = new Set<string>();
  for (const h of snap.hotspots ?? []) {
    for (const login of h.authorLogins ?? []) fromHotspots.add(login);
  }
  return fromHotspots.size > 0 ? [...fromHotspots] : null;
}
