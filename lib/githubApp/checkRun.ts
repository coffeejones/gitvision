// The Gate — a GitHub Check Run driven by the deterministic change-blast verdict.
//
// The App posted only a comment before; this adds a pass/warn/fail Check on the
// PR's head commit. The conclusion is an HONEST signal (Jonas's call): clear →
// success, review → neutral, high-risk → failure. A red failure does NOT block
// merge on its own — that's the repo's choice via branch protection (mark the
// check "required"); our conclusion only sets the colour.
//
// Idempotent per commit: re-runs on synchronize land on a new head_sha (a fresh
// check), and a re-processed same-sha find-or-updates by (name, head_sha). Never
// throws — a missing `checks:write` permission just skips the check (the comment
// still posts).

import type { Octokit } from "octokit";
import { getInstallationClient } from "./auth";
import type { ChangeBlastReport } from "../changeBlast/types";

export const CHECK_NAME = "CodeTrawl Gate";

export type GateConclusion = "success" | "neutral" | "failure";

const VERDICT_CONCLUSION: Record<ChangeBlastReport["verdict"], GateConclusion> = {
  clear: "success",
  review: "neutral",
  "high-risk": "failure",
};

export interface GateOutput {
  conclusion: GateConclusion;
  title: string;
  summary: string;
}

const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

/** Pure: map a blast report to the Check Run conclusion + human output. Exported
 *  for unit testing (no GitHub). */
export function gateOutput(
  report: ChangeBlastReport,
  opts: { mergeUrl: string; receiptUrl?: string },
): GateOutput {
  const conclusion = VERDICT_CONCLUSION[report.verdict];
  const walls = report.loadBearingTouched.length;
  const reached = report.combinedDependents;

  const title =
    report.verdict === "clear"
      ? "Clear — no load-bearing code changed without a guarding test"
      : report.verdict === "review"
        ? `Review — touches ${n(report.wallsTouched.length, "wall", "walls")} · reaches ${n(reached, "file", "files")}`
        : `High blast — ${n(walls, "load-bearing wall", "load-bearing walls")} · reaches ${n(reached, "file", "files")}`;

  const links = [`[Merge confidence ↗](${opts.mergeUrl})`];
  if (opts.receiptUrl) links.push(`[Merge receipt ↗](${opts.receiptUrl})`);

  const summary = [
    `**${report.headline}**`,
    "",
    `- Load-bearing walls touched: **${report.loadBearingTouched.length}**`,
    `- Files the change reaches: **${report.combinedDependents}**`,
    `- Guarding tests updated: **${report.mappedTestsUpdated} / ${report.testsToRun.length}**`,
    "",
    links.join(" · "),
    "",
    "_Deterministic — cited to imports + call edges. No LLM in this verdict._",
  ].join("\n");

  return { conclusion, title, summary };
}

export interface PostCheckInput {
  installationId: number;
  owner: string;
  repo: string;
  headSha: string;
  output: GateOutput;
  /** Where the check's "Details" link points (the merge-confidence page). */
  detailsUrl: string;
}

export type PostCheckResult =
  | { action: "created" | "updated"; checkRunId: number }
  | { action: "skipped"; reason: string };

export interface CheckRunDeps {
  getInstallationClient: typeof getInstallationClient;
}

export const defaultCheckRunDeps: CheckRunDeps = { getInstallationClient };

/** Create or update the Gate Check Run on a PR's head commit. Never throws — a
 *  403 (no checks:write) or any API failure returns { skipped } so the comment
 *  path keeps flowing. */
export async function postCheckRun(
  input: PostCheckInput,
  deps: CheckRunDeps = defaultCheckRunDeps,
): Promise<PostCheckResult> {
  const { installationId, owner, repo, headSha, output, detailsUrl } = input;
  const logCtx = `${owner}/${repo}@${headSha.slice(0, 8)} installation=${installationId}`;

  let octokit: Octokit;
  try {
    octokit = await deps.getInstallationClient(installationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app check] auth failed ${logCtx}: ${msg}`);
    return { action: "skipped", reason: `auth failed: ${msg}` };
  }

  const params = {
    owner,
    repo,
    name: CHECK_NAME,
    head_sha: headSha,
    status: "completed" as const,
    conclusion: output.conclusion,
    details_url: detailsUrl,
    output: { title: output.title, summary: output.summary },
  };

  // Find an existing run for this exact commit so a re-processed sha updates in
  // place rather than stacking duplicate checks.
  let existingId: number | undefined;
  try {
    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      check_name: CHECK_NAME,
      per_page: 1,
    });
    existingId = data.check_runs[0]?.id;
  } catch {
    // listForRef also needs checks:read — treat a failure as "no existing" and
    // let the create below surface the real permission error.
    existingId = undefined;
  }

  try {
    if (existingId !== undefined) {
      const { data } = await octokit.rest.checks.update({
        ...params,
        check_run_id: existingId,
      });
      console.log(`[github-app check] updated ${logCtx} run=${data.id} ${output.conclusion}`);
      return { action: "updated", checkRunId: data.id };
    }
    const { data } = await octokit.rest.checks.create(params);
    console.log(`[github-app check] created ${logCtx} run=${data.id} ${output.conclusion}`);
    return { action: "created", checkRunId: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github-app check] post failed ${logCtx}: ${msg}`);
    return { action: "skipped", reason: `post failed: ${msg}` };
  }
}
