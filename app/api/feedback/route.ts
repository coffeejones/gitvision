// POST /api/feedback — accept user-submitted feedback, persist to disk,
// optionally forward to a webhook (v0.74).
//
// Lives outside the existing /api/sessions and /api/jobs trees because
// feedback is a separate concern: no auth, no owner-id, no diffing. A
// caller submits once, gets a 200, moves on.
//
// Rate limiting: 5 submissions per IP per hour. Generous enough for
// real usage (someone reports a bug, then a related one), tight enough
// to deter casual abuse. Distributed abuse needs a CAPTCHA — out of
// scope for an alpha.

import { NextResponse } from "next/server";
import { submitFeedback } from "@/lib/feedback";
import {
  validateFeedback,
  type FeedbackInput,
} from "@/lib/feedbackTypes";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`feedback:${ip}`, RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "Too many feedback submissions in the last hour. Try again later.",
        resetAt: rl.resetAt,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
          ),
        },
      }
    );
  }

  let body: Partial<FeedbackInput>;
  try {
    body = (await req.json()) as Partial<FeedbackInput>;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const errors = validateFeedback(body);
  if (errors) {
    return NextResponse.json(
      { error: "validation_failed", errors },
      { status: 400 }
    );
  }

  // Server-side context that we add ourselves (clients don't get to
  // forge their user agent here — we read it from the request).
  const userAgent = req.headers.get("user-agent") ?? undefined;

  try {
    const result = await submitFeedback(
      {
        type: body.type!,
        description: body.description!,
        email: body.email,
        pageUrl: body.pageUrl,
        userAgent: body.userAgent ?? userAgent,
        sessionId: body.sessionId,
      },
      { ip }
    );
    return NextResponse.json({ ok: true, id: result.id }, { status: 200 });
  } catch (err) {
    // Disk write failed — most likely Railway volume is full or
    // write-protected. Surface a generic 500; logs will show details.
    console.error("[feedback] submitFeedback failed:", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: "Could not save feedback. Try again in a moment.",
      },
      { status: 500 }
    );
  }
}
