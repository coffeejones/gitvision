// Activation status — which env-gated production features are actually wired.
//
// Path B ("activate the built pieces") is mostly config, not code: the Gate,
// Merge Receipts, the Watch cron, and the AI explainer are all built and degrade
// gracefully when their secret/permission is absent. The pain is VERIFYING a
// switch flipped — otherwise you have to trigger a real PR / wait for a cron to
// know. This exposes the wiring (booleans + the last real Watch run) through the
// founder-metrics tap so a flip is confirmable at a glance. It reads presence
// ONLY — never a secret's value.

/** In-memory: the last time the Watch cron actually ran a real (non-dry) sweep.
 *  Resets on deploy — a daily cron repopulates it within a day, so a long-null
 *  value past `startedAt` + a day means the cron isn't firing (check CRON_SECRET
 *  on Railway + the GitHub Actions secret). */
let watchLastRunMs: number | null = null;

export function recordWatchRun(atMs: number): void {
  watchLastRunMs = atMs;
}

export function lastWatchRun(): string | null {
  return watchLastRunMs != null ? new Date(watchLastRunMs).toISOString() : null;
}

export interface ActivationStatus {
  /** RECEIPT_SECRET set → the Gate signs Merge Receipts (else it still posts
   *  the check + comment, just no signed certificate). */
  receiptSecret: boolean;
  /** CRON_SECRET set → the Watch cron authenticates. Also needs the matching
   *  GitHub Actions secret for the workflow to send it. */
  cronSecret: boolean;
  /** The GitHub App (PR Gate) is configured (id + private key present). Whether
   *  it has the `checks:write` permission can't be read here — verify that by
   *  opening a PR and seeing the "CodeTrawl Gate" check appear. */
  githubApp: boolean;
  /** ANTHROPIC_API_KEY set → the per-function AI explainer is live. */
  aiExplainer: boolean;
  /** ISO of the last real Watch cron sweep since this process started, or null
   *  (see watchLastRunMs). */
  watchLastRun: string | null;
}

/** Presence-only snapshot of the env-gated features. Never returns a value. */
export function readActivation(): ActivationStatus {
  return {
    receiptSecret: !!process.env.RECEIPT_SECRET,
    cronSecret: !!process.env.CRON_SECRET,
    githubApp: !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY),
    aiExplainer: !!process.env.ANTHROPIC_API_KEY,
    watchLastRun: lastWatchRun(),
  };
}
