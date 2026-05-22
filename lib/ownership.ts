// Server-side ownership check for session-scoped API routes.
//
// Extracted from app/api/sessions/[id]/route.ts so the same logic governs
// every mutating endpoint (DELETE/PATCH on the session itself, plus the
// AI-budget endpoints under /summary and /health, plus refresh).
// Inline-duplication was the audit-flagged hole on the AI routes —
// they simply forgot to call the check, which left the Anthropic budget
// exposed to anyone who knew a session id.
//
// Ownership has two ladders (v0.76+):
//   1. Strong claim: session.userId matches the caller's Better Auth
//      user id. This is the only path for sessions created while
//      logged in.
//   2. Legacy / pre-login claim: session.ownerId matches the
//      X-Owner-Id header. Sessions created anonymously (no userId)
//      use this; once a session has a userId, the cookie no longer
//      overrides — even from the original creator's browser.
//
// Sessions with no ownerId AND no userId (pre-v0.26 legacy) remain
// open to any caller — the audit-flagged hole was about endpoints
// forgetting the check entirely, not about ownerless sessions.
//
// Split into a pure decision function (`checkSessionOwnership`) and
// a request-bound wrapper (`requireSessionOwnership`). The pure
// function takes already-extracted claims, so tests don't need to
// mock Better Auth or construct full Request objects — they just
// pass in strings.
//
// Server-only — uses Request which is a runtime construct. Don't import
// from "use client" components.

import { NextResponse } from "next/server";
import { auth } from "./auth";
import type { Session } from "./types";
import { OWNER_ID_HEADER } from "./ownerId";

export type OwnershipDecision = "allowed" | "denied";

/** Pure ownership decision — given a session record and the caller's
 *  already-extracted user id + owner id, return whether they're
 *  allowed to mutate. No I/O, no headers, no Better Auth. Easy to
 *  test in isolation. */
export function checkSessionOwnership(
  session: Pick<Session, "userId" | "ownerId">,
  callerUserId: string | null,
  callerOwnerId: string | null
): OwnershipDecision {
  // Strong claim path: session is bound to a user account.
  if (session.userId) {
    return callerUserId === session.userId ? "allowed" : "denied";
  }
  // Legacy / pre-login path: no userId on the session.
  if (!session.ownerId) return "allowed"; // open ownerless session
  return callerOwnerId === session.ownerId ? "allowed" : "denied";
}

/** Verify the caller owns this session. Returns null when the caller is
 *  permitted (proceed with the handler); returns a Response (403) when
 *  not (return it from the handler to short-circuit).
 *
 *  Async because we read the Better Auth session cookie. Cheap when no
 *  user-owned session is involved — Better Auth short-circuits on a
 *  missing cookie. */
export async function requireSessionOwnership(
  session: Session,
  req: Request
): Promise<Response | null> {
  // Only fetch the auth session if it could matter — saves a DB hit on
  // legacy ownerless sessions and on cookie-only sessions when nobody
  // is logged in.
  const callerUserId = session.userId
    ? ((await auth.api.getSession({ headers: req.headers }))?.user.id ??
      null)
    : null;
  const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
  const decision = checkSessionOwnership(session, callerUserId, callerOwnerId);
  if (decision === "allowed") return null;
  return forbidden();
}

function forbidden(): Response {
  return NextResponse.json(
    {
      error:
        "This session belongs to a different account. Sign in with the right account, or create a new analysis.",
    },
    { status: 403 }
  );
}
