// GitHub App webhook signature verification + event dispatch.
//
// Design rationale: eval/strategy/github-app-skeleton-2026-05.md.
//
// This module is the security boundary for incoming webhooks. Every
// request hitting /api/github/webhook is verified here before its
// payload is parsed or trusted in any way.

import crypto from "node:crypto";

import { handleInstallationEvent } from "./events/installation";
import { handlePullRequestEvent } from "./events/pullRequest";

/**
 * Outcome of dispatching a webhook event.
 *
 *   accepted — filters passed; if backgroundWork is set, the route
 *              handler will schedule it via Next.js `after()` so the
 *              heavy pipeline runs detached from the webhook response
 *   skipped  — filtered out for an expected reason (bot, draft, etc.)
 *   error    — payload was malformed or handler failed unexpectedly
 *
 * The webhook route returns 200 in every case so GitHub doesn't retry;
 * the discriminator is purely for our logs + tests.
 */
export type HandleResult =
  | {
      status: "accepted";
      reason?: string;
      /** Heavy work to run via `after()` after the 200 ships. */
      backgroundWork?: () => Promise<unknown>;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

/**
 * Verify an incoming webhook's HMAC-SHA256 signature.
 *
 * GitHub sends the signature in the `X-Hub-Signature-256` header as
 * `sha256=<hex>`. We compute HMAC-SHA256(rawBody, secret) and
 * constant-time-compare against the provided digest.
 *
 * Returns false (never throws) on any failure path. Caller maps false
 * to a 401 response.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expectedHex = signatureHeader.slice("sha256=".length);
  // Expected digest must be a full SHA-256 hex string (64 chars).
  if (expectedHex.length !== 64) return false;
  if (!/^[0-9a-f]+$/i.test(expectedHex)) return false;

  const computedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Length check already enforced above, but timingSafeEqual still
  // requires equal-length buffers — keep the guard defensive.
  if (expectedHex.length !== computedHex.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHex, "hex"),
      Buffer.from(computedHex, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Dispatch a parsed webhook event to its handler.
 *
 * Routes by event type. Unknown events are logged-and-skipped — not
 * an error (GitHub may send event types we don't subscribe to via
 * future API changes, or testing tools may probe with arbitrary
 * types).
 */
export async function dispatchEvent(
  eventType: string,
  payload: unknown,
  deliveryId?: string | null,
): Promise<HandleResult> {
  switch (eventType) {
    case "pull_request":
      return handlePullRequestEvent(payload, deliveryId);

    case "installation":
      return handleInstallationEvent(payload, deliveryId);

    case "ping":
      // Sent once when the webhook is first configured. Acknowledge
      // so the GitHub UI shows a green check.
      console.log(`[github-app] ping delivery=${deliveryId ?? "—"}`);
      return { status: "accepted", reason: "ping" };

    default:
      console.log(
        `[github-app] ignoring unsupported event=${eventType} delivery=${deliveryId ?? "—"}`,
      );
      return { status: "skipped", reason: `unsupported event: ${eventType}` };
  }
}
