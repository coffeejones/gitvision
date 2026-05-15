// runReview — the top-level "what happens when a pull_request passes
// all filters" orchestration. Composes:
//   1. runAnalysisPipeline (clone, analyze, diff, rules)
//   2. formatPrComment (markdown render)
//   3. postPrComment (find-or-update via installation token)
//
// Called from the pull_request event handler's backgroundWork closure;
// scheduled via Next's `after()` so it runs detached from the webhook
// response. Never throws — every failure is caught + logged + returned
// as a typed RunReviewResult so the route handler can keep flowing.
//
// Dependency-injectable so tests can drive the orchestration without
// touching GitHub or the analysis pipeline.

import type { PullRequestEvent } from "./events/pullRequest";
import { formatPrComment } from "./comment";
import {
  defaultPipelineDeps,
  runAnalysisPipeline,
  type PipelineDeps,
  type PipelineResult,
} from "./pipeline";
import {
  defaultPosterDeps,
  postPrComment,
  type PostCommentResult,
  type PosterDeps,
} from "./poster";

export interface RunReviewDeps {
  runAnalysisPipeline: typeof runAnalysisPipeline;
  formatPrComment: typeof formatPrComment;
  postPrComment: typeof postPrComment;
  pipelineDeps: PipelineDeps;
  posterDeps: PosterDeps;
  /** Used to build the "Full analysis" link in the comment footer.
   *  Default reads GITVISION_PUBLIC_URL env var, falling back to
   *  localhost so dev preview still produces a clickable link. */
  workspaceBaseUrl: string;
}

export function defaultRunReviewDeps(): RunReviewDeps {
  return {
    runAnalysisPipeline,
    formatPrComment,
    postPrComment,
    pipelineDeps: defaultPipelineDeps,
    posterDeps: defaultPosterDeps,
    workspaceBaseUrl:
      process.env.GITVISION_PUBLIC_URL?.replace(/\/+$/, "") ||
      "http://localhost:3000",
  };
}

export type RunReviewResult =
  | {
      ok: true;
      pipelineResult: PipelineResult;
      postResult: PostCommentResult;
    }
  | {
      ok: false;
      reason: string;
      pipelineResult?: PipelineResult;
    };

export async function runReview(
  event: PullRequestEvent,
  deps: RunReviewDeps = defaultRunReviewDeps(),
  deliveryId?: string | null,
): Promise<RunReviewResult> {
  const prNumber = event.pull_request.number;
  const [owner, repoName] = event.repository.full_name.split("/", 2);
  const logCtx = `delivery=${deliveryId ?? "—"} ${event.repository.full_name}#${prNumber}`;

  if (!owner || !repoName) {
    const reason = `unexpected repository.full_name=${event.repository.full_name}`;
    console.error(`[github-app runReview] ${reason} ${logCtx}`);
    return { ok: false, reason };
  }

  const installationId = event.installation?.id;
  if (!installationId) {
    // Should be present on app-installed repos. If GitHub sent a
    // pull_request event without an installation id, we have no way to
    // authenticate for comment posting.
    const reason = "no installation id on event";
    console.error(`[github-app runReview] ${reason} ${logCtx}`);
    return { ok: false, reason };
  }

  // 1. Run the heavy analysis pipeline
  const pipelineResult = await deps.runAnalysisPipeline(
    event,
    deps.pipelineDeps,
    deliveryId,
  );

  // 2. Render the comment body. Returns null on pipeline failure —
  // we skip posting in that case (silent failure beats noisy failure
  // for v1 per design).
  const body = deps.formatPrComment(pipelineResult, {
    workspaceBaseUrl: deps.workspaceBaseUrl,
  });
  if (!body) {
    console.log(
      `[github-app runReview] no comment body (pipeline ok=${pipelineResult.ok}) ${logCtx}`,
    );
    return {
      ok: false,
      reason: "no comment body — pipeline did not produce postable output",
      pipelineResult,
    };
  }

  // 3. Post or update the comment via installation auth
  const postResult = await deps.postPrComment(
    { installationId, owner, repo: repoName, prNumber, body },
    deps.posterDeps,
  );

  console.log(
    `[github-app runReview] done ${logCtx} pipeline=${pipelineResult.ok ? "ok" : "fail"} post=${postResult.action}`,
  );

  return { ok: true, pipelineResult, postResult };
}
