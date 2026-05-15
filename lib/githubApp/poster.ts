// PR-comment poster.
//
// Given a markdown body, authenticates as the installation that owns
// the repo, searches existing PR comments for our marker, and either
// updates the existing one or creates a new one.
//
// We MUST find-or-update (not always create) so that re-runs on
// pull_request.synchronize don't append an N+1 stack of redundant
// comments to the PR. The marker in lib/githubApp/comment.ts is the
// idempotency key.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md §"webhook flow"
// step 14.

import type { Octokit } from "octokit";

import { getInstallationClient } from "./auth";
import { COMMENT_MARKER } from "./comment";

export interface PostCommentInput {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}

export type PostCommentResult =
  | { action: "created"; commentId: number }
  | { action: "updated"; commentId: number }
  | { action: "skipped"; reason: string };

export interface PosterDeps {
  getInstallationClient: typeof getInstallationClient;
}

export const defaultPosterDeps: PosterDeps = {
  getInstallationClient,
};

/**
 * Post or update our PR-review comment on a pull request.
 *
 * Never throws — every failure (auth, list, create, update) is caught
 * and reported as `{ action: "skipped", reason }` so the background
 * runner can keep flowing without bringing down the request hook.
 */
export async function postPrComment(
  input: PostCommentInput,
  deps: PosterDeps = defaultPosterDeps,
): Promise<PostCommentResult> {
  const { installationId, owner, repo, prNumber, body } = input;
  const logCtx = `${owner}/${repo}#${prNumber} installation=${installationId}`;

  // 1. Authenticate
  let octokit: Octokit;
  try {
    octokit = await deps.getInstallationClient(installationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app poster] auth failed ${logCtx}: ${msg}`);
    return { action: "skipped", reason: `auth failed: ${msg}` };
  }

  // 2. Find existing comment via marker. Paginate so large PRs with
  // 100+ comments don't hide ours past page 1.
  let existingId: number | undefined;
  try {
    const comments = await octokit.paginate(
      octokit.rest.issues.listComments,
      { owner, repo, issue_number: prNumber, per_page: 100 },
    );
    const ours = comments.find(
      (c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER),
    );
    existingId = ours?.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app poster] list failed ${logCtx}: ${msg}`);
    return { action: "skipped", reason: `list failed: ${msg}` };
  }

  // 3. Update or create
  if (existingId !== undefined) {
    try {
      const { data } = await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingId,
        body,
      });
      console.log(
        `[github-app poster] updated ${logCtx} comment=${data.id}`,
      );
      return { action: "updated", commentId: data.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[github-app poster] update failed ${logCtx} comment=${existingId}: ${msg}`,
      );
      return { action: "skipped", reason: `update failed: ${msg}` };
    }
  }

  try {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    console.log(`[github-app poster] created ${logCtx} comment=${data.id}`);
    return { action: "created", commentId: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app poster] create failed ${logCtx}: ${msg}`);
    return { action: "skipped", reason: `create failed: ${msg}` };
  }
}
