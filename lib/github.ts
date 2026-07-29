// GitHub API client using Octokit.
//
// Token resolution (v0.81 — per-user OAuth tokens):
//   - Each helper function accepts an optional `client` argument so the
//     caller can supply a user-scoped Octokit instance (built from the
//     user's GitHub OAuth access token via getGithubTokenForUser).
//   - When no client is passed, callers fall back to the module-level
//     `octokit` instance, which uses GITHUB_TOKEN from env (5000 req/hr
//     shared across all requests) or unauthenticated (60 req/hr) if
//     the env var is missing.
//   - analyzeRepo accepts opts.userToken — when set it constructs a
//     user-scoped Octokit once at the top and passes it down to every
//     subordinate helper. This isolates per-user rate limits (every
//     authenticated user gets their own 5000 req/hr) and is the
//     foundation for private-repo support (a token issued with the
//     `repo` scope can fetch private metadata that the server-side
//     PAT can't).
//
// Token never leaks out of this module — Octokit holds it in a closure;
// it's not stored on the returned snapshot, not logged, and not exposed
// to client code.

import { Octokit } from "octokit";
import type {
  RepoMeta,
  Contributor,
  CommitSummary,
  LanguageBreakdown,
  AnalysisSnapshot,
  FileHotspot,
  CoChangeEdge,
  CommitIndexEntry,
  PullRequestSummary,
} from "./types";
import {
  buildFileGraph,
  buildFileGraphFromDir,
  downloadAndExtract,
  SubdirNotFoundError,
  validateExcludeFolders,
  makeExcludeMatcher,
} from "./graph";
import { analyzeRepoHistory, type GitLogCommit } from "./gitLog";
import { analyzeDependencyHealth } from "./depsHealth/index";
import { analyzeDirectory } from "./codeAnalysis/analyze";
import type { ParseLayer } from "./shadowGraph/parseCache";
import { ALL_PLUGINS } from "./codeAnalysis/plugins/all";
import { computeDriftMetrics } from "./driftMetrics";
import { computeWeakSuite, weakSuiteSummary } from "./weakSuite";
import { computeCiHardening } from "./ciHardening";
import {
  scanForSecrets,
  walkRepoForSecrets,
} from "./security/secretsScan";
import { scanForRiskyPatterns } from "./security/riskyPatterns";
import { classifySinks } from "./security/reachability";
import type { RiskyPatternScanResult } from "./security/riskyPatterns";
import type { SecretScanResult } from "./security/types";
import { cmpStr } from "./deterministicSort";

/** Build a new Octokit instance authenticated with the given token, or
 *  unauthenticated if `null`/`undefined` is passed (60 req/hr). Used by
 *  `analyzeRepo` when a user-token is provided, and by the module-level
 *  default below for the env-PAT fallback path. */
export function makeOctokit(token?: string | null): Octokit {
  return new Octokit({
    auth: token || undefined,
    userAgent: "CodeTrawl/0.1",
  });
}

/** Module-level default — env GITHUB_TOKEN or unauthenticated. Used as
 *  the fallback when a helper is called without an explicit client and
 *  no user-token resolution is in progress. Demo session refreshes,
 *  background-recovery jobs, and unauthenticated API routes all hit
 *  this. */
const octokit = makeOctokit(process.env.GITHUB_TOKEN);

/** Structured error thrown by analyzeRepo when GitHub returns an
 *  access-related failure (404 / 401 / 403). Callers can introspect
 *  `.code` to render appropriate UX:
 *
 *    "repo-not-found"  — 404. Either the repo doesn't exist OR it
 *                        exists but is private and the caller's token
 *                        can't see it. Treat as "needs re-authorize
 *                        or GitHub connection" — both are recoverable.
 *    "unauthorized"    — 401. Token expired, revoked, or never valid.
 *                        Action: re-authorize.
 *    "rate-limit"      — 403 with rate-limit body. Action: wait, or
 *                        sign in with GitHub for higher quota.
 *
 *  Job-error messages are prefixed with `[gh:<code>]` so the UI can
 *  parse the code without parsing English text (see lib/jobs.ts +
 *  components/RepoInputForm). */
export class GithubAccessError extends Error {
  constructor(
    public readonly code:
      | "repo-not-found"
      | "unauthorized"
      | "rate-limit",
    message: string,
    public readonly owner?: string,
    public readonly repo?: string,
  ) {
    super(message);
    this.name = "GithubAccessError";
  }
  /** Render to the wire-format used by jobs.ts → polled job-status →
   *  UI. The `[gh:<code>]` prefix lets the client parse the code
   *  reliably without depending on the exact English wording. */
  toWireFormat(): string {
    return `[gh:${this.code}] ${this.message}`;
  }
}

/** Octokit's `RequestError` carries a numeric `.status`. We don't import
 *  the concrete class because Octokit's typings change frequently —
 *  a structural duck-type check is more stable. */
interface OctokitLikeError {
  status?: number;
  message?: string;
}

function isOctokitError(err: unknown): err is OctokitLikeError {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in (err as Record<string, unknown>) &&
    typeof (err as { status: unknown }).status === "number"
  );
}

/** Convert an Octokit error from `fetchRepoMeta` to a structured
 *  GithubAccessError. Called only from analyzeRepo's gateway check —
 *  if the repo-meta call succeeds, downstream errors usually aren't
 *  access-related (graph extraction, code-analysis timeouts, etc.). */
function coerceGithubAccessError(
  err: unknown,
  owner: string,
  repo: string,
  hasUserToken: boolean,
): never {
  if (isOctokitError(err)) {
    if (err.status === 404) {
      throw new GithubAccessError(
        "repo-not-found",
        hasUserToken
          ? `Repository ${owner}/${repo} not found. Either it doesn't exist, or your GitHub link doesn't have access to it.`
          : `Repository ${owner}/${repo} not found. If it's a private repo, sign in with GitHub to analyze it.`,
        owner,
        repo,
      );
    }
    if (err.status === 401) {
      throw new GithubAccessError(
        "unauthorized",
        `GitHub token is invalid or expired. Re-authorize GitHub from your account settings.`,
        owner,
        repo,
      );
    }
    if (err.status === 403) {
      throw new GithubAccessError(
        "rate-limit",
        hasUserToken
          ? `GitHub rate limit reached on your account. Try again in a few minutes.`
          : `GitHub rate limit reached. Sign in with GitHub for a higher per-user quota, or try again later.`,
        owner,
        repo,
      );
    }
  }
  // Not a recognised access error — bubble up unchanged.
  throw err;
}

/**
 * Parse a GitHub repo URL/shorthand into { owner, repo }.
 * Accepts:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - github.com/owner/repo
 *  - owner/repo
 */
export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  // Restrict owner/repo to GitHub's actual charset (owner: letters, digits,
  // hyphens; repo: also "." and "_"). This rejects "..", URL-encoded slashes,
  // and other junk at the cheap-validation layer before any value reaches the
  // Octokit calls or the tarball-extract pipeline — tighter than the old
  // [^/\s]+ which accepted arbitrary non-space characters.
  const OWNER = "[A-Za-z0-9-]+";
  const REPO = "[A-Za-z0-9._-]+";
  const patterns = [
    new RegExp(`^https?:\\/\\/github\\.com\\/(${OWNER})\\/(${REPO})`),
    new RegExp(`^github\\.com\\/(${OWNER})\\/(${REPO})`),
    new RegExp(`^(${OWNER})\\/(${REPO})$`),
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) {
      const owner = m[1];
      const repo = m[2];
      // The charset still permits "." / ".." as a repo segment — reject those
      // explicitly so a traversal-shaped name never flows downstream.
      if (repo === "." || repo === "..") return null;
      return { owner, repo };
    }
  }
  return null;
}

/** Parse a GitHub pull-request URL → { owner, repo, number }. Accepts the full
 *  https URL, the scheme-less github.com form, and an owner/repo#N shorthand.
 *  Returns null for anything that isn't a PR reference (Arc 5). */
export function parsePrUrl(
  input: string,
): { owner: string; repo: string; number: number } | null {
  const trimmed = input.trim().replace(/\/$/, "");
  const OWNER = "[A-Za-z0-9-]+";
  const REPO = "[A-Za-z0-9._-]+";
  const patterns = [
    new RegExp(`^https?:\\/\\/github\\.com\\/(${OWNER})\\/(${REPO})\\/pull\\/(\\d+)`),
    new RegExp(`^github\\.com\\/(${OWNER})\\/(${REPO})\\/pull\\/(\\d+)`),
    new RegExp(`^(${OWNER})\\/(${REPO})#(\\d+)$`),
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) {
      const repo = m[2];
      if (repo === "." || repo === "..") return null;
      const number = Number.parseInt(m[3], 10);
      if (!Number.isFinite(number) || number <= 0) return null;
      return { owner: m[1], repo, number };
    }
  }
  return null;
}

export interface PrRefEndpoint {
  owner: string;
  repo: string;
  ref: string;
  sha: string;
}

export interface PrRefs {
  title: string;
  base: PrRefEndpoint;
  head: PrRefEndpoint;
}

/** Resolve a pull request's base + head endpoints (owner/repo/ref/sha). Head may
 *  live in a fork, so its owner/repo can differ from base's; when the fork was
 *  deleted (head.repo null) we fall back to the base repo. (Arc 5) */
export async function fetchPrRefs(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PrRefs> {
  const client = token ? makeOctokit(token) : octokit;
  try {
    const { data } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });
    return {
      title: data.title,
      base: {
        owner: data.base.repo.owner.login,
        repo: data.base.repo.name,
        ref: data.base.ref,
        sha: data.base.sha,
      },
      head: {
        owner: data.head.repo?.owner.login ?? owner,
        repo: data.head.repo?.name ?? repo,
        ref: data.head.ref,
        sha: data.head.sha,
      },
    };
  } catch (err) {
    // A missing/private PR (or a bad number) becomes a clean GithubAccessError
    // with the same wire format the rest of the pipeline surfaces, instead of a
    // raw Octokit stack trace leaking to the client. coerceGithubAccessError
    // returns `never` (always throws), so control never falls through.
    coerceGithubAccessError(err, owner, repo, !!token);
  }
}

/** When a user pastes an org / user profile URL (https://github.com/ZeebleChat)
 *  parseRepoUrl returns null because there's no repo segment. This helper
 *  detects that specific case and returns the org / user name so the API
 *  layer can surface a more actionable error than the generic
 *  "Could not parse GitHub URL" message.
 *
 *  Returns null when the input doesn't match an org / user URL shape —
 *  including random garbage and full repo URLs (those parseRepoUrl
 *  already handles). */
export function extractOrgOrUserFromUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/$/, "");
  // Only the bare-org URL shape — exactly one path segment after
  // github.com, no trailing /repo, /tree, /blob, etc.
  const m = trimmed.match(/^https?:\/\/github\.com\/([^\/\s?#]+)$/);
  return m ? m[1] : null;
}

// parseDeepLinkSubdir lives in lib/githubUrl.ts so it can be imported from
// client components without dragging server-only deps (Octokit, tar) into
// the browser bundle.
export { parseDeepLinkSubdir } from "./githubUrl";

export async function fetchRepoMeta(
  owner: string,
  repo: string,
  client: Octokit = octokit,
): Promise<RepoMeta> {
  const { data } = await client.rest.repos.get({ owner, repo });
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.subscribers_count,
    openIssues: data.open_issues_count,
    defaultBranch: data.default_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    pushedAt: data.pushed_at,
    language: data.language,
    license: data.license?.spdx_id ?? null,
    homepage: data.homepage,
    topics: data.topics ?? [],
    // v0.81+: persist GitHub's visibility flag. The read-side access
    // check on /session/[id]/* uses this to gate private-repo sessions
    // to the owner only. Without it, anyone with the session URL could
    // see private codebase metadata.
    private: data.private,
  };
}

export async function fetchContributors(
  owner: string,
  repo: string,
  client: Octokit = octokit,
): Promise<Contributor[]> {
  // GitHub caps contributors endpoint at 500 by default; that's plenty for MVP.
  const { data } = await client.rest.repos.listContributors({
    owner,
    repo,
    per_page: 100,
  });
  return data
    .filter((c): c is typeof c & { login: string } => !!c.login)
    .map((c) => ({
      login: c.login,
      avatarUrl: c.avatar_url ?? "",
      htmlUrl: c.html_url ?? `https://github.com/${c.login}`,
      contributions: c.contributions,
    }));
}

export async function fetchLanguages(
  owner: string,
  repo: string,
  client: Octokit = octokit,
): Promise<LanguageBreakdown> {
  const { data } = await client.rest.repos.listLanguages({ owner, repo });
  return data as LanguageBreakdown;
}

/**
 * Fetch recent commits. We cap at `maxPages * 100` to avoid burning the rate limit on huge repos.
 * For MVP we sample the most recent 300 commits — enough for hotspot signal without pain.
 */
export async function fetchRecentCommits(
  owner: string,
  repo: string,
  maxPages = 3,
  client: Octokit = octokit,
): Promise<CommitSummary[]> {
  const commits: CommitSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await client.rest.repos.listCommits({
      owner,
      repo,
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const c of data) {
      commits.push({
        sha: c.sha,
        message: c.commit.message.split("\n")[0].slice(0, 200),
        authorLogin: c.author?.login ?? null,
        authorName: c.commit.author?.name ?? "unknown",
        authorEmail: c.commit.author?.email ?? "",
        date: c.commit.author?.date ?? c.commit.committer?.date ?? new Date().toISOString(),
      });
    }
    if (data.length < 100) break;
  }
  return commits;
}

/**
 * For a sample of recent commits, fetch their file-change details to compute hotspots.
 * Very expensive API-wise — we only look at the latest N commits.
 */
export async function fetchCommitFileChanges(
  owner: string,
  repo: string,
  commitShas: string[],
  client: Octokit = octokit,
): Promise<Map<string, { files: string[]; authorLogin: string | null; authorName?: string; date: string }>> {
  const result = new Map<string, { files: string[]; authorLogin: string | null; authorName?: string; date: string }>();
  // Sequential to respect rate-limit; could parallelize with a concurrency cap later.
  for (const sha of commitShas) {
    try {
      const { data } = await client.rest.repos.getCommit({ owner, repo, ref: sha });
      result.set(sha, {
        files: (data.files ?? []).map((f) => f.filename),
        authorLogin: data.author?.login ?? null,
        date: data.commit.author?.date ?? "",
      });
    } catch {
      // skip individual failures, continue
    }
  }
  return result;
}

/**
 * Compute file hotspots from a set of commit-file changes.
 * Score = churn * log(authors+1) — favors files touched often by multiple people.
 */
export function computeHotspots(
  perCommitFiles: Map<string, { files: string[]; authorLogin: string | null; authorName?: string; date: string }>
): FileHotspot[] {
  const byFile = new Map<
    string,
    {
      churn: number;
      authors: Set<string>;
      logins: Set<string>;
      lastModified: string;
      commits: string[];
    }
  >();

  for (const [sha, info] of perCommitFiles) {
    for (const file of info.files) {
      const entry = byFile.get(file) ?? {
        churn: 0,
        authors: new Set<string>(),
        logins: new Set<string>(),
        lastModified: "",
        commits: [] as string[],
      };
      entry.churn += 1;
      // Identity, not login. Using authorLogin alone dropped every commit not
      // authored from a users.noreply.github.com address — which zeroed both
      // `authors` AND, through it, `score = churn * log(authors+1)`. On four of
      // eleven stored snapshots EVERY hotspot scored 0, so the sort below was a
      // no-op and the "hotspot" list was really insertion order. The name is
      // always present on the git-log path; the REST path still has only a login.
      const identity = info.authorLogin ?? info.authorName;
      if (identity) entry.authors.add(identity);
      if (info.authorLogin) entry.logins.add(info.authorLogin);
      if (info.date && info.date > entry.lastModified) entry.lastModified = info.date;
      entry.commits.push(sha);
      byFile.set(file, entry);
    }
  }

  const hotspots: FileHotspot[] = [];
  for (const [path, data] of byFile) {
    // `authors` counts PEOPLE (login or name); `authorLogins` stays logins only,
    // because FileDetailsPanel turns each entry into a https://github.com/<x>
    // link and a display name there produces a broken URL.
    const identities = [...data.authors];
    const authorLogins = identities.filter((a) => data.logins.has(a));
    const score = data.churn * Math.log(identities.length + 1);
    hotspots.push({
      path,
      churn: data.churn,
      authors: identities.length,
      authorLogins,
      lastModified: data.lastModified,
      score,
      commits: data.commits,
    });
  }
  hotspots.sort((a, b) => b.score - a.score);
  return hotspots;
}

/**
 * Compute co-change edges: file pairs that frequently change together.
 * Skips mega-commits (>15 files) which are usually renames/refactors and would dominate.
 */
export function computeCoChange(
  perCommitFiles: Map<string, { files: string[]; authorLogin: string | null; authorName?: string; date: string }>,
  allowedFiles: Set<string>,
  opts: { maxEdges?: number; minCount?: number } = {}
): CoChangeEdge[] {
  const maxEdges = opts.maxEdges ?? 150;
  const minCount = opts.minCount ?? 2;
  const pairs = new Map<string, number>();

  for (const [, info] of perCommitFiles) {
    const files = info.files.filter((f) => allowedFiles.has(f));
    if (files.length < 2 || files.length > 15) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [a, b] = files[i] < files[j] ? [files[i], files[j]] : [files[j], files[i]];
        const key = `${a}|${b}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: CoChangeEdge[] = [];
  for (const [key, count] of pairs) {
    if (count < minCount) continue;
    const [from, to] = key.split("|");
    edges.push({ from, to, count });
  }
  edges.sort((a, b) => b.count - a.count);
  return edges.slice(0, maxEdges);
}

/**
 * Does this repo have a README (any variant)? Uses GitHub's dedicated endpoint
 * which searches for README.md, README, readme.rst, etc. case-insensitively.
 * Much more reliable than scanning our hotspot/fileGraph paths — READMEs are
 * often stable (no churn) and may live outside the dep-graph's visible area.
 */
export async function fetchHasReadme(
  owner: string,
  repo: string,
  client: Octokit = octokit,
): Promise<boolean> {
  try {
    await client.rest.repos.getReadme({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch recent pull requests (all states). Best-effort — errors return an empty list
 * so analysis still proceeds on repos without PRs or with restricted access.
 */
export async function fetchPullRequests(
  owner: string,
  repo: string,
  maxPages = 2,
  client: Octokit = octokit,
): Promise<PullRequestSummary[]> {
  const out: PullRequestSummary[] = [];
  try {
    for (let page = 1; page <= maxPages; page++) {
      const { data } = await client.rest.pulls.list({
        owner,
        repo,
        state: "all",
        per_page: 100,
        page,
        sort: "created",
        direction: "desc",
      });
      if (data.length === 0) break;
      for (const pr of data) {
        out.push({
          number: pr.number,
          title: pr.title.slice(0, 200),
          state: pr.state as "open" | "closed",
          merged: !!pr.merged_at,
          authorLogin: pr.user?.login ?? null,
          createdAt: pr.created_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at,
        });
      }
      if (data.length < 100) break;
    }
  } catch {
    // swallow — repos may not have PRs, or token may lack scope
  }
  return out;
}

export function computeCommitActivity(commits: CommitSummary[]): { week: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (const c of commits) {
    // ISO week start (Monday) as key
    const d = new Date(c.date);
    if (isNaN(d.getTime())) continue;
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    const key = monday.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => cmpStr(a.week, b.week));
}

/**
 * High-level: produce a complete analysis snapshot.
 */
function gitLogCommitsToPerCommitFiles(
  commits: GitLogCommit[]
): Map<string, { files: string[]; authorLogin: string | null; authorName?: string; date: string }> {
  const m = new Map<
    string,
    { files: string[]; authorLogin: string | null; authorName?: string; date: string }
  >();
  for (const c of commits) {
    m.set(c.sha, {
      files: c.files,
      authorLogin: c.authorLogin,
      authorName: c.authorName,
      date: c.date,
    });
  }
  return m;
}

function gitLogCommitsToSummaries(
  commits: GitLogCommit[],
  limit: number
): CommitSummary[] {
  // git log is already newest-first; take the first `limit`.
  return commits.slice(0, limit).map((c) => ({
    sha: c.sha,
    message: c.message,
    authorLogin: c.authorLogin,
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    date: c.date,
  }));
}

export interface AnalyzeRepoOptions {
  /** When set, codeAnalysis + file-graph extraction is scoped to this
   *  subdir. The result snapshot's `analyzedSubdir` is set to the same
   *  value so refresh re-analyzes the same scope. Whole-repo metadata
   *  (contributors, PRs, language mix, dep-health) still uses the full
   *  repo — those signals don't make sense to scope. v0.24+. */
  subdir?: string | null;
  /** Git ref to analyze — branch name, tag, or commit SHA. When unset,
   *  uses the repo's default branch (the common case). Drives both the
   *  diff-aware workflow (analyze a feature branch vs main, then
   *  analyze_diff the two session ids) and the user-facing branch picker.
   *  Scopes the code structure (tarball → codeAnalysis + secret-scan +
   *  file-graph), the git history (git log <ref>), and dep-health (the
   *  branch's manifests). Whole-repo metadata that isn't branch-specific —
   *  stars, languages, contributors, PRs — stays repo-wide. Must be a safe
   *  ref (validated via isSafeGitRef upstream). v0.79+. */
  ref?: string | null;
  /** GitHub OAuth access token for the calling user. When provided, all
   *  GitHub API calls during this analysis are authenticated against
   *  the user's token instead of the server-wide GITHUB_TOKEN env var.
   *  Two consequences:
   *    1. Rate limit isolation — each user gets their own 5000 req/hr
   *       budget instead of sharing the server-wide one.
   *    2. Private-repo access — a token issued with the `repo` scope
   *       can fetch private repo metadata + tarballs that the server
   *       PAT can't see.
   *  When unset, falls back to the module-level `octokit` (env-PAT or
   *  unauthenticated). v0.81+. */
  userToken?: string | null;
  /** Folders to drop from the code-structure analysis ("point only at the
   *  real code"). Threaded into tarball extraction (codeAnalysis, file-graph,
   *  secret-scan), the git-history hotspots/co-change, and dep-health manifest
   *  discovery — so an excluded folder disappears from every structural view.
   *  Stored on the snapshot as `analyzedExcludeFolders` and re-applied on
   *  refresh. Whole-repo metadata (stars, languages, contributors, PRs) stays
   *  repo-wide. */
  excludeFolders?: string[] | null;
  /** Best-effort seam for the Shadow-Graph patcher. Invoked with the parse
   *  layer (the parsed files + resolver contexts + content hashes) once code
   *  analysis succeeds, so a later `simulate` can rebuild the graph
   *  incrementally instead of re-analyzing the whole repo. Fired-and-forgotten
   *  so it can neither fail session creation nor block it on the gzip/disk write;
   *  the one synchronous cost — serializing the layer — is bounded and deferred
   *  off the critical tick (see writeParseCache), with the full worker offload
   *  left to Stage 3. NOT invoked when code analysis times out, errors, or the
   *  walk hit the file cap (a truncated base can't serve the golden fast path). */
  onParseLayer?: (layer: ParseLayer) => void | Promise<unknown>;
}

export async function analyzeRepo(
  owner: string,
  repo: string,
  opts: AnalyzeRepoOptions = {}
): Promise<AnalysisSnapshot> {
  const subdir = opts.subdir ?? null;
  const explicitRef = opts.ref ?? null;
  // Re-validate defensively (callers should pass validated input, but this is
  // a public entry point). Empty list = no exclusion.
  const excludeFolders = validateExcludeFolders(opts.excludeFolders);
  // Build a request-scoped Octokit if the caller supplied a user-token;
  // otherwise reuse the module-level default. Threaded through every
  // helper below so the entire analysis runs against a single token.
  const client = opts.userToken ? makeOctokit(opts.userToken) : octokit;

  // Gateway check — fail fast on repo-meta. If we can't reach the repo
  // at all (404 / 401 / 403), every downstream call will fail too;
  // surface a structured GithubAccessError now so the UI can render
  // "re-authorize" / "connect GitHub" actions. Costs one sequential
  // round-trip in the happy path, but the downstream Promise.all
  // already serializes on this same data anyway. (v0.81 — paired with
  // the per-user OAuth token threading above.)
  let repoMeta: RepoMeta;
  try {
    repoMeta = await fetchRepoMeta(owner, repo, client);
  } catch (err) {
    coerceGithubAccessError(err, owner, repo, !!opts.userToken);
  }

  const [
    contributors,
    languages,
    restRecentCommits,
    pullRequests,
    history,
    hasReadme,
    dependencyHealths,
  ] = await Promise.all([
    fetchContributors(owner, repo, client),
    fetchLanguages(owner, repo, client),
    fetchRecentCommits(owner, repo, 3, client),
    fetchPullRequests(owner, repo, 2, client),
    analyzeRepoHistory(owner, repo, explicitRef),
    fetchHasReadme(owner, repo, client),
    analyzeDependencyHealth(client, owner, repo, explicitRef ?? "HEAD", excludeFolders),
  ]);

  const usingGitLog = history.commits.length > 0;

  // Decide which commit set drives hotspots/co-change/activity/scrubber.
  // git log gives full history with file data; REST gives 300 commits sampled
  // + requires extra calls for file data (capped at 80).
  let perCommitFiles: Map<
    string,
    { files: string[]; authorLogin: string | null; authorName?: string; date: string }
  >;
  let recentCommits: CommitSummary[];
  let historySource: AnalysisSnapshot["historySource"];
  let commitIndex: Record<string, CommitIndexEntry> | undefined;

  if (usingGitLog) {
    perCommitFiles = gitLogCommitsToPerCommitFiles(history.commits);
    recentCommits = gitLogCommitsToSummaries(history.commits, 300);
    commitIndex = {};
    for (const c of history.commits) {
      commitIndex[c.sha] = { d: c.date, a: c.authorLogin, n: c.authorName };
    }
    const sorted = [...history.commits]
      .map((c) => c.date)
      .filter((d) => !!d)
      .sort();
    historySource = {
      kind: "git-log",
      commitCount: history.commits.length,
      earliest: sorted[0],
      latest: sorted[sorted.length - 1],
      elapsedMs: history.elapsedMs,
      truncated: history.truncated,
    };
  } else {
    // Fallback: REST-based 80-commit sample (pre-gitLog behavior)
    recentCommits = restRecentCommits;
    const hotspotShas = recentCommits.slice(0, 80).map((c) => c.sha);
    perCommitFiles = await fetchCommitFileChanges(owner, repo, hotspotShas, client);
    historySource = {
      kind: "rest-sample",
      commitCount: recentCommits.length,
      earliest: recentCommits[recentCommits.length - 1]?.date,
      latest: recentCommits[0]?.date,
      truncated: history.truncated,
    };
  }

  // Apply exclude-folders to the git-history file set so hotspots, co-change,
  // and activity reflect only the real code. The tarball extraction is filtered
  // separately (codeAnalysis/file-graph); history paths come from git log, not
  // the extracted tree, so they need the filter applied here too.
  if (excludeFolders.length > 0) {
    const isExcluded = makeExcludeMatcher(excludeFolders);
    for (const entry of perCommitFiles.values()) {
      entry.files = entry.files.filter((f) => !isExcluded(f));
    }
  }

  const allHotspots = computeHotspots(perCommitFiles);
  const hotspots = allHotspots.slice(0, 120); // top 120 files is plenty for visuals
  const allowedFiles = new Set(hotspots.map((h) => h.path));
  const coChange = computeCoChange(perCommitFiles, allowedFiles);

  // Commit activity: use the FULL source (git log = years; REST = ~sample span)
  const activitySource: CommitSummary[] = usingGitLog
    ? history.commits.map((c) => ({
        sha: c.sha,
        message: "",
        authorLogin: c.authorLogin,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        date: c.date,
      }))
    : recentCommits;
  const commitActivity = computeCommitActivity(activitySource);

  // Dependency graph + code-analysis CodeGraph — both tarball-based. Run them
  // off a single shared tarball-extract and run in parallel via Promise.all.
  //
  // Big-repo handling: codeAnalysis is wrapped in CODE_ANALYSIS_TIMEOUT_MS.
  // For repos like golang/go (5,000+ files past our cap), the AST pipeline
  // alone can take 35-60s — past Railway's request timeout. When we hit the
  // budget, we send the snapshot WITHOUT codeGraph and store a skip reason.
  // The session creates successfully; the Code tab degrades to an explicit
  // "skipped: too large" message. Long-term we'll move codeAnalysis to a
  // background worker so big repos can be analyzed properly — see PROGRESS.md
  // "Big-repo limits".
  const CODE_ANALYSIS_TIMEOUT_MS = 25_000;
  let fileGraph;
  let codeGraph: import("./types").CodeGraph | undefined;
  let codeGraphSkipReason: string | undefined;
  let secretFindings: SecretScanResult | undefined;
  let riskyPatternFindings: RiskyPatternScanResult | undefined;
  let sinkFindings: import("./security/reachability").ReachabilityReport | undefined;
  let ciHardening: import("./ciHardening/types").CIHardeningReport | undefined;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const extracted = await downloadAndExtract(
      client,
      owner,
      repo,
      explicitRef ?? repoMeta.defaultBranch,
      { subdir, excludeFolders }
    );
    cleanup = extracted.cleanup;

    // Race codeAnalysis against a timeout. The .catch swallows any post-
    // timeout rejection (the tarball gets deleted by `cleanup` while a
    // tree-sitter parser may still be reading from it) so it doesn't bubble
    // up as an unhandled rejection.
    const codeAnalysisPromise = analyzeDirectory(extracted.extractDir, ALL_PLUGINS)
      .then((r) => ({
        kind: "ok" as const,
        codeGraph: r.codeGraph,
        // The parse layer, carried through the race so the success branch can
        // hand it to the cache-write seam. Same object references as `r` — no
        // copy — and simply unused when no `onParseLayer` was supplied.
        layer: {
          files: r.files,
          pluginByFile: r.pluginByFile,
          extras: r.extras,
          contentHashes: r.codeGraph.contentHashes ?? {},
          truncated: r.truncated ? "Walker hit MAX_FILES cap" : undefined,
          scope: {
            subdir: subdir ?? undefined,
            excludeFolders: excludeFolders.length > 0 ? excludeFolders : undefined,
          },
        } satisfies ParseLayer,
      }))
      .catch((err) => {
        console.error(
          `codeAnalysis failed for ${owner}/${repo}:`,
          err instanceof Error ? err.message : err
        );
        return { kind: "err" as const };
      });

    const TIMEOUT = Symbol("codeAnalysisTimeout");
    const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) =>
      setTimeout(() => resolve(TIMEOUT), CODE_ANALYSIS_TIMEOUT_MS)
    );

    // Secret-scan + risky-pattern pass — single walk feeds both scans.
    // Walks .env / config files (for secrets) AND source code (for
    // risky-pattern detection). Both scans run in parallel with
    // codeAnalysis + fileGraph since they all read from the same
    // extracted tarball directory. `.catch returns undefined so a
    // scan failure doesn't tank the whole analysis (these are
    // additive signals, not critical-path data). (v0.81+ — added
    // riskyPatternFindings alongside secretFindings.)
    const securityPromise = walkRepoForSecrets(extracted.extractDir)
      .then(({ files, truncated }) => {
        const secResult = scanForSecrets(files);
        if (truncated && !secResult.truncated) {
          secResult.truncated = `Walker hit file cap — repo may have additional secret-bearing files.`;
        }
        const riskyResult = scanForRiskyPatterns(files);
        if (truncated && !riskyResult.truncated) {
          riskyResult.truncated = `Walker hit file cap — repo may have additional risky-pattern occurrences.`;
        }
        return { sec: secResult, risky: riskyResult };
      })
      .catch((err) => {
        console.error(
          `securityScan failed for ${owner}/${repo}:`,
          err instanceof Error ? err.message : err
        );
        return undefined;
      });

    // CI-hardening — reads .github/workflows from the same extracted tree.
    // Additive signal, so a failure returns undefined rather than tanking the
    // analysis. (Arc 4 — Evidence Desk.)
    const ciHardeningPromise = computeCiHardening(
      extracted.extractDir,
      owner,
    ).catch((err) => {
      console.error(
        `ciHardening failed for ${owner}/${repo}:`,
        err instanceof Error ? err.message : err
      );
      return undefined;
    });

    const [fg, cgResult, secAndRisky, ciResult] = await Promise.all([
      buildFileGraphFromDir(extracted.extractDir),
      Promise.race([codeAnalysisPromise, timeoutPromise]),
      securityPromise,
      ciHardeningPromise,
    ]);

    fileGraph = fg;
    secretFindings = secAndRisky?.sec;
    riskyPatternFindings = secAndRisky?.risky;
    ciHardening = ciResult;
    if (cgResult === TIMEOUT) {
      codeGraph = undefined;
      codeGraphSkipReason = `Code analysis exceeded ${
        CODE_ANALYSIS_TIMEOUT_MS / 1000
      }s — repo is too large for the current pipeline. The other tabs still reflect the latest snapshot.`;
    } else if (cgResult.kind === "err") {
      codeGraph = undefined;
      codeGraphSkipReason =
        "Code analysis failed — see server logs. Other snapshot data is still accurate.";
    } else {
      codeGraph = cgResult.codeGraph;
      // Classify the plugins' sinks by reachability. Pure function over the
      // graph — no I/O — so it rides along here rather than needing its own
      // stage. Only meaningful when codeGraph exists: a timed-out analysis has
      // no graph, and "no findings" would then be a lie rather than a result.
      sinkFindings = classifySinks(codeGraph);
      // Hand the parse layer to the cache-write seam (Shadow-Graph patcher).
      // Fire-and-forget with a swallowed error: this is a pure optimization for
      // a future incremental simulate, never on the session-creation critical
      // path. Skipped for a truncated walk — the fast path needs a complete base
      // (readParseCache rejects truncated entries anyway, so this just saves the
      // wasted write). On Railway's long-lived process the background write
      // completes reliably; on exit an in-flight write is simply lost (harmless).
      if (opts.onParseLayer && !cgResult.layer.truncated) {
        const emit = opts.onParseLayer;
        const layer = cgResult.layer;
        // Defer the call into a microtask so a SYNCHRONOUS throw from the
        // callback becomes a rejection the `.catch` handles — never a synchronous
        // throw that escapes into the outer try/catch and discards codeGraph.
        void Promise.resolve()
          .then(() => emit(layer))
          .catch((err) => {
            console.error(
              `onParseLayer failed for ${owner}/${repo}:`,
              err instanceof Error ? err.message : err
            );
          });
      }
    }
  } catch (err) {
    // SubdirNotFoundError is a USER input error — they pointed at a path
    // that doesn't exist in the repo. Falling back to a whole-repo
    // analysis would be misleading (the user explicitly asked for subset
    // scope; the session shouldn't quietly ignore that). Re-throw so the
    // API endpoint can surface the message to the user as a 400.
    if (cleanup) await cleanup();
    if (err instanceof SubdirNotFoundError) throw err;

    // Other tarball / network failures — fall back to the public
    // buildFileGraph which has its own download + cleanup, and skip
    // codeGraph for this run.
    fileGraph = await buildFileGraph(
      client,
      owner,
      repo,
      explicitRef ?? repoMeta.defaultBranch,
      { subdir, excludeFolders }
    );
    codeGraph = undefined;
    codeGraphSkipReason = `Tarball extraction failed: ${
      err instanceof Error ? err.message : "unknown error"
    }`;
    cleanup = null; // already cleaned up above
  } finally {
    if (cleanup) await cleanup();
  }

  // Rate limit snapshot (useful for UI)
  let rateLimitInfo: AnalysisSnapshot["rateLimitInfo"];
  try {
    const { data } = await client.rest.rateLimit.get();
    rateLimitInfo = {
      limit: data.resources.core.limit,
      remaining: data.resources.core.remaining,
      reset: new Date(data.resources.core.reset * 1000).toISOString(),
    };
  } catch {
    /* ignore */
  }

  // Drift fingerprint — captured per snapshot so future sweeps can diff it
  // into trends. Can't be backfilled, so we capture it whenever we have a code
  // graph (Arc 3).
  const driftMetrics = codeGraph ? computeDriftMetrics(codeGraph) : undefined;

  // Weak-Suite (Arc 1): aggregate assertion-quality summary. The full, gated
  // report is recomputed from the code graph at read time; only the aggregate
  // rides on the snapshot to drive the health signal.
  const weakSuite = codeGraph
    ? weakSuiteSummary(computeWeakSuite(codeGraph))
    : undefined;

  return {
    fetchedAt: new Date().toISOString(),
    repo: repoMeta,
    contributors,
    languages,
    recentCommits,
    hotspots,
    coChange,
    commitActivity,
    fileGraph,
    codeGraph,
    codeGraphSkipReason,
    driftMetrics,
    weakSuite,
    pullRequests,
    commitIndex,
    historySource,
    hasReadme,
    dependencyHealths: dependencyHealths.length > 0 ? dependencyHealths : undefined,
    analyzedSubdir: subdir ?? undefined,
    analyzedRef: explicitRef ?? undefined,
    analyzedExcludeFolders: excludeFolders.length > 0 ? excludeFolders : undefined,
    secretFindings,
    riskyPatternFindings,
    sinkFindings,
    ciHardening,
    rateLimitInfo,
  };
}
