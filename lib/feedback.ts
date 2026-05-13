// File-backed feedback submission with optional Discord/Slack-webhook
// fan-out (v0.74). SERVER-ONLY — uses node:fs and node:path. Client
// code imports types + validation from lib/feedbackTypes.ts instead.
//
// Design choices:
//   - File storage matches the sessions + jobs pattern: write to disk,
//     atomic temp+rename. Survives Railway redeploys, no DB needed.
//   - Optional webhook (env: GITVISION_FEEDBACK_WEBHOOK_URL) — when set,
//     each submission also POSTs a formatted payload so the maintainer
//     gets a real-time ping. File storage is the source of truth; the
//     webhook is fire-and-forget convenience.
//   - No PII collected unless the user opts in by typing an email.
//   - Length caps on every field so a runaway script can't fill the
//     disk with megabyte-long submissions.
//
// What this module is NOT:
//   - A ticket tracker. We don't update / close / reply to entries
//     here. That happens elsewhere (or nowhere — alpha-scale).
//   - A bug-report normalizer. We capture raw-ish input plus a few
//     auto-included context fields (URL, user agent, session id).

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWriteJson } from "./atomicWrite";
import type { FeedbackInput } from "./feedbackTypes";

// Intentionally NOT re-exporting from feedbackTypes here. Re-exports
// across a server-only / browser-safe split confuse Turbopack's
// dependency analyzer in dev mode (it traces transitively, sees
// node:fs, and can get stuck in a recompile loop). Callers that
// need types should import from "@/lib/feedbackTypes" directly;
// callers that need the storage function import this module.

const MAX_URL_LEN = 500;
const MAX_USER_AGENT_LEN = 500;
const MAX_SESSION_ID_LEN = 64;
const MAX_DESCRIPTION_LEN = 4000;
const MAX_EMAIL_LEN = 200;

export interface FeedbackEntry extends FeedbackInput {
  id: string;
  /** ISO timestamp set server-side. */
  submittedAt: string;
  /** Caller IP at submission time, for rate-limit auditing only — not
   *  exposed to the maintainer's webhook payload. */
  ip?: string;
}

function feedbackDir(): string {
  const dataDir =
    process.env.GITVISION_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "feedback");
}

async function ensureDir() {
  await fs.mkdir(feedbackDir(), { recursive: true });
}

function feedbackPath(id: string) {
  return path.join(feedbackDir(), `${id}.json`);
}


/** Apply length caps + trimming to context fields that come from
 *  client-side window state. Defensive — we always trust ourselves
 *  more than untrusted input. */
function clampContext(input: FeedbackInput): FeedbackInput {
  return {
    type: input.type,
    description: input.description.trim().slice(0, MAX_DESCRIPTION_LEN),
    email: input.email?.trim().slice(0, MAX_EMAIL_LEN) || undefined,
    pageUrl: input.pageUrl?.slice(0, MAX_URL_LEN),
    userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LEN),
    sessionId: input.sessionId?.slice(0, MAX_SESSION_ID_LEN),
  };
}

export interface SubmitResult {
  id: string;
  webhookForwarded: boolean;
}

/** Persist a feedback entry to disk and (best-effort) forward to the
 *  configured webhook. Throws on disk write failure; webhook errors
 *  are swallowed so a flaky third-party doesn't 500 the user's
 *  submission. */
export async function submitFeedback(
  input: FeedbackInput,
  ctx: { ip?: string } = {}
): Promise<SubmitResult> {
  await ensureDir();
  const cleaned = clampContext(input);
  const entry: FeedbackEntry = {
    ...cleaned,
    id: nanoid(12),
    submittedAt: new Date().toISOString(),
    ip: ctx.ip,
  };
  await atomicWriteJson(feedbackPath(entry.id), entry);

  const webhookUrl = process.env.GITVISION_FEEDBACK_WEBHOOK_URL;
  let webhookForwarded = false;
  if (webhookUrl) {
    try {
      const lines: string[] = [
        `**New ${entry.type} feedback** · \`${entry.id}\``,
        entry.description.length > 1500
          ? entry.description.slice(0, 1500) + "…"
          : entry.description,
      ];
      if (entry.email) lines.push(`Email: ${entry.email}`);
      if (entry.sessionId) lines.push(`Session: ${entry.sessionId}`);
      if (entry.pageUrl) lines.push(`Page: ${entry.pageUrl}`);
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lines.join("\n\n") }),
      });
      webhookForwarded = res.ok;
    } catch {
      // Webhook unreachable — disk has the source of truth.
    }
  }

  return { id: entry.id, webhookForwarded };
}
