// GitHub App webhook signature verification + event dispatch.
//
// Design rationale: eval/strategy/github-app-skeleton-2026-05.md.
//
// This module is the security boundary for incoming webhooks. Every
// request hitting /api/github/webhook is verified here before its
// payload is parsed or trusted in any way.

import crypto from "node:crypto";

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
 * Lightly extract structured fields from an unknown payload, for
 * logging. Real type-safe parsing happens in the event handlers
 * (Commit 3+).
 */
function extractPayloadMetadata(payload: unknown): {
  action: string | undefined;
  repoFullName: string | undefined;
} {
  if (typeof payload !== "object" || payload === null) {
    return { action: undefined, repoFullName: undefined };
  }
  const p = payload as Record<string, unknown>;
  const action = typeof p.action === "string" ? p.action : undefined;
  const repo =
    typeof p.repository === "object" && p.repository !== null
      ? (p.repository as Record<string, unknown>)
      : null;
  const repoFullName =
    repo && typeof repo.full_name === "string" ? repo.full_name : undefined;
  return { action, repoFullName };
}

/**
 * Dispatch a parsed webhook event to its handler.
 *
 * Commit 1 stub: logs the event and returns. Real per-event handlers
 * (events/pullRequest.ts, events/installation.ts) land in Commit 3+.
 */
export async function dispatchEvent(
  eventType: string,
  payload: unknown,
  deliveryId?: string | null,
): Promise<void> {
  const { action, repoFullName } = extractPayloadMetadata(payload);
  console.log(
    `[github-app] event=${eventType} action=${action ?? "—"} repo=${repoFullName ?? "—"} delivery=${deliveryId ?? "—"}`,
  );
}
