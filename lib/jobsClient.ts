// Client-side helper for polling /api/jobs/<id>. Pure browser code — does
// NOT import from lib/jobs.ts (which has fs deps that webpack can't bundle
// for the browser).
//
// Usage from a React component:
//
//   const ctrl = new AbortController();
//   try {
//     const finalJob = await pollJob(jobId, (j) => {
//       // update UI with current status
//     }, { signal: ctrl.signal });
//     // status === "done", finalJob.sessionId set
//   } catch (err) {
//     // failed | aborted | network drop
//   }
//
// Component cleanup should call ctrl.abort() to stop polling on unmount.

import type { Job } from "./types";

export interface PollJobOptions {
  /** Milliseconds between poll requests. Default 2000 — fast enough that
   *  the user feels something is happening, slow enough that we don't
   *  hammer the server during long analyses. */
  intervalMs?: number;
  /** Abort signal — when fired, the in-flight fetch is cancelled and the
   *  poll loop exits with an "aborted" rejection. Use AbortController
   *  in the calling component to cancel on unmount or user action. */
  signal?: AbortSignal;
}

/** Poll a job until it reaches a terminal state (done | failed). Resolves
 *  with the final job record on success; rejects with a descriptive error
 *  on failure, abort, network drop, or 404 (job not found). */
export async function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  opts: PollJobOptions = {}
): Promise<Job> {
  const intervalMs = opts.intervalMs ?? 2000;
  while (true) {
    if (opts.signal?.aborted) {
      throw new Error("Polling aborted");
    }
    const res = await fetch(`/api/jobs/${jobId}`, {
      signal: opts.signal,
      // Don't cache responses — we explicitly want fresh status each time
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          "Job no longer exists. It may have been cleaned up. Please try again."
        );
      }
      throw new Error(`Polling failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as { job?: Job; error?: string };
    if (!data.job) {
      throw new Error(data.error || "Polling response missing job field");
    }
    const job = data.job;
    onUpdate(job);
    if (job.status === "done") return job;
    if (job.status === "failed") {
      throw new Error(job.error || "Analysis failed");
    }
    // pending or running — wait, then loop. Use a Promise so the abort
    // signal can interrupt the sleep too.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, intervalMs);
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new Error("Polling aborted"));
        },
        { once: true }
      );
    });
  }
}
