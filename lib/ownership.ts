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
import { cookies, headers as nextHeaders } from "next/headers";
import { auth } from "./auth";
import type { Session } from "./types";
import { OWNER_ID_COOKIE, OWNER_ID_HEADER } from "./ownerId";

export type OwnershipDecision = "allowed" | "denied";

/** Was the session's analyzed repo private at the time of the latest
 *  snapshot? Private-repo sessions are gated to the owner on reads;
 *  public-repo sessions (and demo sessions) are open to anyone with
 *  the URL. Falls back to false for legacy snapshots that pre-date
 *  the `private` field — those are all from public-repo analyses
 *  done before per-user OAuth landed, so the default is safe. */
export function isSessionPrivate(session: Session): boolean {
  const latest = session.snapshots[session.snapshots.length - 1];
  return latest?.repo?.private === true;
}

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

/** Pure read-access decision — given a session and the caller's
 *  already-extracted identity, return whether they're allowed to view
 *  the analysis.
 *
 *  Rules:
 *    - Public-repo sessions: anyone with the URL can read (default).
 *    - Private-repo sessions: only the owner can read (strong-claim
 *      or legacy-cookie path, same ladder as mutations).
 *
 *  This separation lets us keep public-repo sharing frictionless
 *  (paste the URL on Slack, anyone clicks through) while making the
 *  private-repo URL "owner-only" — same data-classification model as
 *  a Google Doc with sharing set to "specific people only". */
export function checkSessionReadAccess(
  session: Session,
  callerUserId: string | null,
  callerOwnerId: string | null,
): OwnershipDecision {
  if (!isSessionPrivate(session)) return "allowed";
  return checkSessionOwnership(session, callerUserId, callerOwnerId);
}

/** Request-bound read-access enforcement for API route handlers
 *  (where we have a Request object). Returns null when allowed —
 *  call sites that get null should proceed with the handler. Returns
 *  a 404 Response when denied — call sites should return it directly
 *  to short-circuit.
 *
 *  404 (not 403) is deliberate: a private session URL leaked to a
 *  non-owner shouldn't disclose that the session exists, only that
 *  the path doesn't resolve. Same mental model as a Google Doc
 *  shared with "specific people only" — non-allowed visitors get a
 *  "not found" page, not an "access denied" page. */
export async function requireSessionReadAccessFromRequest(
  session: Session,
  req: Request,
): Promise<Response | null> {
  if (!isSessionPrivate(session)) return null;
  const callerUserId = session.userId
    ? ((await auth.api.getSession({ headers: req.headers }))?.user.id ??
      null)
    : null;
  const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
  const decision = checkSessionReadAccess(
    session,
    callerUserId,
    callerOwnerId,
  );
  if (decision === "allowed") return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Server-side read-access enforcement for use in React Server
 *  Components (where we don't have a NextRequest, just `next/headers`
 *  cookies + headers). Returns `true` when access is allowed; callers
 *  who get `false` should call `notFound()` so non-owners see a generic
 *  404 instead of being told "you don't have access to this session"
 *  (which would leak the session's existence + its visibility status).
 *
 *  Async because it reads the Better Auth session cookie. Cheap when
 *  the session isn't private — short-circuits before any I/O. */
export async function requireSessionReadAccess(
  session: Session,
): Promise<boolean> {
  // Fast path: public-repo sessions are open to everyone.
  if (!isSessionPrivate(session)) return true;

  // Private-repo path — fetch the caller's auth state. Better Auth's
  // getSession() accepts a `headers` Headers iterable; we pass the
  // server-component request headers.
  const h = await nextHeaders();
  const authSession = await auth.api.getSession({ headers: h });
  const callerUserId = authSession?.user.id ?? null;

  // Owner-id is stored both as a header (set by client fetch) and a
  // cookie (set by getOrCreateOwnerId on first visit). Server
  // components see cookies but rarely the X-Owner-Id header (browsers
  // don't add it to navigations). Prefer cookie, fall back to header
  // for completeness.
  const c = await cookies();
  const callerOwnerId =
    c.get(OWNER_ID_COOKIE)?.value ?? h.get(OWNER_ID_HEADER) ?? null;

  const decision = checkSessionReadAccess(
    session,
    callerUserId,
    callerOwnerId,
  );
  return decision === "allowed";
}
