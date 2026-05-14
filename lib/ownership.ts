// Server-side ownership check for session-scoped API routes.
//
// Extracted from app/api/sessions/[id]/route.ts so the same logic governs
// every mutating endpoint (DELETE/PATCH on the session itself, plus the
// AI-budget endpoints under /summary and /health). Inline-duplication was
// the audit-flagged hole on the AI routes — they simply forgot to call
// the check, which left the Anthropic budget exposed to anyone who knew
// a session id.
//
// Server-only — uses Request which is a runtime construct. Don't import
// from "use client" components.

import { NextResponse } from "next/server";
import type { Session } from "./types";
import { OWNER_ID_HEADER } from "./ownerId";

/** Verify the caller owns this session. Returns null when the caller is
 *  permitted (proceed with the handler); returns a Response (403) when
 *  not (return it from the handler to short-circuit).
 *
 *  Legacy sessions (pre-v0.26, no ownerId set) accept any caller — the
 *  same posture as the pre-extraction inline check. Tighten if/when we
 *  migrate to real auth (OAuth, v2+). */
export function requireSessionOwnership(
  session: Session,
  req: Request
): Response | null {
  if (!session.ownerId) return null; // legacy ownerless session — open
  const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
  if (callerOwnerId === session.ownerId) return null;
  return NextResponse.json(
    {
      error:
        "This session belongs to a different browser. Open the original tab to modify it, or create a new analysis.",
    },
    { status: 403 }
  );
}
