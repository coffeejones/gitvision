// POST /api/admin/reset-billing — operator tool to reset a single user's
// billing state back to Free (open-case), clearing the Polar subscription
// link. Needed when a user's row is stranded after a Polar org/config change:
// the local row points at a subscription that no longer maps to the active
// org, so the in-app switch/cancel buttons can't operate on it. Resetting lets
// the user do a clean fresh checkout under the current org, after which the
// webhook repopulates the row correctly.
//
// This runs INSIDE the server runtime on purpose: the auth DB is a SQLite file
// on the Railway volume, unreachable from outside the container, so a hosted
// endpoint is the only way to touch prod data.
//
// Security: shared ADMIN_SECRET (env), SHA-256 timing-safe compare, 404 on any
// miss — same model as /api/metrics and /api/cron/watch-monitor. A DEDICATED
// secret (not CRON_SECRET, which also lives in a GitHub Actions secret) so this
// billing-mutating power has the narrowest possible blast radius. Inert (404)
// until ADMIN_SECRET is set. POST only.

import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tokenOk(provided: string | null): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  try {
    return timingSafeEqual(sha(provided), sha(expected));
  } catch {
    return false;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const authz = req.headers.get("authorization");
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!tokenOk(bearer ?? url.searchParams.get("token"))) return notFound();

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? url.searchParams.get("email") ?? "").trim();
  if (!email) {
    return Response.json(
      { ok: false, error: "Provide an email (JSON body { email } or ?email=)." },
      { status: 400 },
    );
  }

  // Snapshot the current billing state so the response shows what was cleared.
  const rows = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      tier: schema.user.tier,
      polarSubscriptionId: schema.user.polarSubscriptionId,
      subscriptionStatus: schema.user.subscriptionStatus,
      cancelAtPeriodEnd: schema.user.cancelAtPeriodEnd,
    })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  const before = rows[0];
  if (!before) {
    return Response.json(
      { ok: false, found: false, email },
      { status: 404 },
    );
  }

  await db
    .update(schema.user)
    .set({
      tier: "open-case",
      polarSubscriptionId: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    })
    .where(eq(schema.user.id, before.id));

  console.log(
    `[admin/reset-billing] reset ${email}: tier ${before.tier} -> open-case, cleared subscription ${
      before.polarSubscriptionId ?? "none"
    } (status ${before.subscriptionStatus ?? "none"})`,
  );

  return Response.json({
    ok: true,
    found: true,
    email,
    before: {
      tier: before.tier,
      polarSubscriptionId: before.polarSubscriptionId,
      subscriptionStatus: before.subscriptionStatus,
      cancelAtPeriodEnd: before.cancelAtPeriodEnd,
    },
    after: {
      tier: "open-case",
      polarSubscriptionId: null,
      subscriptionStatus: null,
      cancelAtPeriodEnd: false,
    },
  });
}
