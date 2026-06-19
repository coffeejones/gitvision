// Server-side tier gate for the AI generation endpoints (AI Briefing +
// Health Check). The /insights page already hides these panels from Free
// users, but the generation routes (/summary, /health) only checked
// ownership + rate-limit + budget — so a Free owner could POST them
// directly (curl) and obtain the Plus-only AI output. This closes that
// bypass at the API layer.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccess } from "@/lib/billing/gates";

/** Returns a 402 Response to short-circuit when the caller's tier does not
 *  include AI Insights (Plus+); returns null to proceed. Resolve the caller
 *  from the Better Auth session — an anonymous owner (no account) is Free by
 *  definition and is denied. */
export async function requireAiInsights(req: Request): Promise<Response | null> {
  const userId =
    (await auth.api.getSession({ headers: req.headers }))?.user?.id ?? null;
  if (userId && (await canAccess(userId, "aiInsights"))) return null;
  return NextResponse.json(
    {
      error:
        "The AI Briefing and Health Check are Plus features. Upgrade at /pricing to generate them.",
      upgrade: true,
    },
    { status: 402 },
  );
}
