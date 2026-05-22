"use server";

// Server Actions for the /account page (v0.75).
//
// Why server actions rather than calling authClient from the browser:
// Better Auth's `setPassword` is intentionally server-only — letting
// the client call it would be a security hole (a stolen session
// cookie could quietly set a password without the legitimate user
// noticing). We wrap it in a server action so the client can still
// trigger the operation, but the auth library only sees a request
// from our own server with the same session.
//
// Why this file isn't in lib/: server actions tied to a specific
// route conventionally live next to that route's page.tsx. Keeps
// the dependency direction clean (page → action → auth) without
// pulling action-only logic into the shared lib.

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

type Result =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Set a password for the currently logged-in user. Used when the
 * caller signed up via GitHub OAuth and has no credential account
 * yet — calling this gives them a second sign-in method.
 *
 * The session is read from the request cookies via `headers()`. We
 * do NOT accept a userId argument from the client; that would let a
 * compromised page set someone else's password.
 */
export async function setPasswordAction(
  newPassword: string
): Promise<Result> {
  // Minimal validation. Better Auth enforces its own length check too,
  // but giving a clearer message client-side avoids a round-trip.
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  try {
    await auth.api.setPassword({
      body: { newPassword },
      headers: await headers(),
    });
    return { ok: true };
  } catch (err) {
    // Better Auth throws an APIError with `.message` on failure
    // (wrong session, password policy violation, etc.). Surface the
    // message verbatim — it's already user-readable.
    const message =
      err instanceof Error
        ? err.message
        : "Couldn't set your password. Try again.";
    return { ok: false, error: message };
  }
}
