// Email sender — wraps Resend so the rest of the codebase doesn't
// have to know about the underlying provider (v0.76+).
//
// Why a wrapper:
//   - Single place to read RESEND_API_KEY + choose the from-address.
//   - We can swap providers later (Postmark, SES) without touching
//     every email-sending call site.
//   - Easier to mock in tests — they import `sendEmail`, not Resend.
//
// Free-tier rules (Resend, May 2026):
//   - Without a verified domain, sender must be `onboarding@resend.dev`
//     AND recipient must be the Resend account's owner email.
//     Good for local dev (Jonas tests on his own inbox).
//   - For production we'll verify repobaron.com in Phase D4 and
//     switch FROM_ADDRESS to `noreply@repobaron.com`.
//
// Server-only. Never import from a "use client" component — would
// drag node:crypto into the browser bundle and leak the API key.

import { Resend } from "resend";

/** Sender address. Falls back to Resend's onboarding domain when no
 *  custom from-address is configured. In production set
 *  EMAIL_FROM=noreply@repobaron.com (or whatever verified address)
 *  via Railway env after verifying the domain on Resend's dashboard. */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "RepoBaron <onboarding@resend.dev>";
}

let cachedClient: Resend | null = null;

/** Lazy-construct the Resend client. We don't want to crash at module
 *  load when RESEND_API_KEY is unset (e.g. in tests, or local-dev
 *  without email features). Callers get a clear error from sendEmail
 *  instead. */
function getClient(): Resend | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

export interface EmailPayload {
  to: string;
  subject: string;
  /** HTML body — what most clients render. */
  html: string;
  /** Plain-text fallback for clients that don't show HTML, and for
   *  spam-filter scoring (purely-HTML emails look spammier). */
  text: string;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: "no-api-key" | "send-failed"; error?: string };

/** Send an email via Resend. Returns a tagged result so callers can
 *  distinguish "we don't have a sender configured" (warn + skip) from
 *  "the send failed at the provider" (retry, log loudly). Never
 *  throws — keeps callers from having to wrap every email-send in
 *  try/catch. */
export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, reason: "no-api-key" };
  }
  try {
    const result = await client.emails.send({
      from: fromAddress(),
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    if (result.error) {
      return {
        ok: false,
        reason: "send-failed",
        error: result.error.message,
      };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      reason: "send-failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
