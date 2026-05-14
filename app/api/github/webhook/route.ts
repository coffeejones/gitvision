// POST /api/github/webhook
//
// GitHub App webhook receiver. Verifies HMAC-SHA256 signature and
// dispatches the event to its handler.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md
//
// Important: we always return 200 once the signature is verified, even
// if the downstream handler throws. GitHub retries 5xx responses, which
// would multiply analysis cost and risk duplicate comments. Failures
// are logged for our visibility, not surfaced back to GitHub.

import { NextResponse, after } from "next/server";

import { dispatchEvent, verifyWebhookSignature } from "@/lib/githubApp/webhook";

// We need raw body bytes for HMAC + node:crypto. App Router defaults to
// node runtime for route handlers, but pinning it makes the intent
// explicit and survives future config drift.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    // App isn't wired up yet — refuse the request rather than silently
    // accepting unauthenticated payloads. 503 because the server itself
    // is misconfigured.
    console.error("[github-app] GITHUB_APP_WEBHOOK_SECRET is not set");
    return new NextResponse("Webhook receiver not configured", {
      status: 503,
    });
  }

  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event");
  const deliveryId = req.headers.get("x-github-delivery");

  if (!signature || !eventType) {
    return new NextResponse("Missing required webhook headers", {
      status: 400,
    });
  }

  // Read body as text BEFORE attempting any JSON parsing — HMAC must be
  // computed against the exact bytes GitHub signed.
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn(
      `[github-app] invalid signature delivery=${deliveryId ?? "—"} event=${eventType}`,
    );
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Parse only after signature passes. Body content is now trusted as
  // having come from GitHub (whoever holds the webhook secret).
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signature was valid but body isn't JSON — shouldn't happen in
    // practice, but treat as a client error since GitHub sent it.
    return new NextResponse("Invalid JSON body", { status: 400 });
  }

  let result;
  try {
    result = await dispatchEvent(eventType, payload, deliveryId);
  } catch (err) {
    // Per design: do NOT propagate handler failure back to GitHub.
    // Logging is our visibility layer.
    console.error(
      `[github-app] dispatch failed delivery=${deliveryId ?? "—"} event=${eventType}:`,
      err,
    );
    return new NextResponse("OK", { status: 200 });
  }

  // Schedule heavy work (clone + analyze + diff + rules + comment) to
  // run AFTER the 200 ships. GitHub's webhook timeout is ~10s for the
  // HTTP response; analysis routinely takes 30s-2min. `after()` lets
  // those two timelines decouple. Pipeline never throws — failures are
  // logged inside the closure.
  if (result.status === "accepted" && result.backgroundWork) {
    after(async () => {
      try {
        await result.backgroundWork!();
      } catch (err) {
        // Defensive — the pipeline catches its own errors, but if
        // anything slips through we still don't want to crash the
        // request lifecycle hook.
        console.error(
          `[github-app] background work failed delivery=${deliveryId ?? "—"}:`,
          err,
        );
      }
    });
  }

  return new NextResponse("OK", { status: 200 });
}
