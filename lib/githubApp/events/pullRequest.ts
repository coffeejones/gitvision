// pull_request event handler.
//
// Applies the v1 filter pipeline (private repo, draft, bot author,
// supported action) and — once filters pass — would hand off to the
// real analysis pipeline (Commit 4). For now it logs intent and
// returns "accepted" so we can validate the filter logic in isolation.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md §"webhook flow".

import { z } from "zod";

import { isBotAuthor } from "../../botDetection";
import type { HandleResult } from "../webhook";

// Actions on a pull_request webhook that should trigger analysis.
// Everything else (closed, labeled, edited, assigned, etc.) is metadata
// from our perspective — no code-state change, no need to re-review.
//
// `ready_for_review` is intentionally included so a previously-drafted
// PR gets analyzed the first time it leaves draft state.
const SUPPORTED_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

// Minimal schema — only the fields we actually read. zod's safeParse
// rejects payloads where required fields are missing or wrong-typed,
// which gives us defense-in-depth even though GitHub's payloads are
// well-defined.
const PullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number(),
    draft: z.boolean().optional(),
    user: z.object({ login: z.string() }),
    base: z.object({ sha: z.string(), ref: z.string() }),
    head: z.object({ sha: z.string(), ref: z.string() }),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
  }),
  repository: z.object({
    full_name: z.string(),
    private: z.boolean(),
    size: z.number().optional(),
    clone_url: z.string(),
    default_branch: z.string().optional(),
  }),
  installation: z.object({ id: z.number() }).optional(),
});

export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;

export async function handlePullRequestEvent(
  payload: unknown,
  deliveryId?: string | null,
): Promise<HandleResult> {
  const parsed = PullRequestEventSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn(
      `[github-app] pull_request payload failed validation delivery=${deliveryId ?? "—"}: ${parsed.error.message}`,
    );
    return { status: "error", reason: "invalid pull_request payload" };
  }

  const { action, pull_request: pr, repository: repo } = parsed.data;
  const logCtx = `delivery=${deliveryId ?? "—"} repo=${repo.full_name} pr=#${pr.number} action=${action}`;

  // Filter 1 — only react to actions that imply a code-state change.
  if (!SUPPORTED_ACTIONS.has(action)) {
    console.log(`[github-app] skip (action not supported) ${logCtx}`);
    return { status: "skipped", reason: `action=${action}` };
  }

  // Filter 2 — v1 is public-repos only. Private support is v2 work
  // (requires OAuth + per-installation session-access model).
  if (repo.private) {
    console.log(`[github-app] skip (private repo) ${logCtx}`);
    return { status: "skipped", reason: "private repo" };
  }

  // Filter 3 — drafts don't get reviewed. The ready_for_review action
  // (in SUPPORTED_ACTIONS above) catches the transition into reviewable.
  if (pr.draft === true) {
    console.log(`[github-app] skip (draft PR) ${logCtx}`);
    return { status: "skipped", reason: "draft PR" };
  }

  // Filter 4 — bot-authored PRs (Dependabot, Renovate, etc.) tend to
  // be high-volume + low-judgment-needed. Skipping protects both our
  // analysis budget and the reviewer's signal-to-noise.
  if (isBotAuthor(pr.user.login)) {
    console.log(
      `[github-app] skip (bot author=${pr.user.login}) ${logCtx}`,
    );
    return { status: "skipped", reason: `bot author: ${pr.user.login}` };
  }

  // All filters passed. The real analysis pipeline lands in Commit 4.
  // For now: log intent, return accepted so callers (and tests) know
  // this PR would be processed end-to-end.
  console.log(`[github-app] accepted ${logCtx} base=${pr.base.sha.slice(0, 8)} head=${pr.head.sha.slice(0, 8)}`);
  return { status: "accepted", reason: "passed all filters" };
}
