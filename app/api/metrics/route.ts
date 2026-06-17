// Private founder-metrics tap (read-only, aggregate, PII-free).
//
// The single new production surface for the metrics tooling — the CLI and the
// digest both read product numbers; this is how they reach prod data without
// shipping an admin UI onto the public site.
//
// Security model:
//   - Gated by a shared secret in METRICS_TOKEN (env), NOT user login — no
//     auth-bypass surface, trivially rotatable.
//   - Compared timing-safely on SHA-256 digests (fixed length, no length leak).
//   - 404 (not 401) on any miss or when the feature is off, so the endpoint
//     doesn't even advertise its own existence.
//   - GET only, read-only, no-store. The payload is counts only — never emails
//     or ids (see lib/metrics.ts).

import { createHash, timingSafeEqual } from "node:crypto";
import { computeMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function sha(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tokenOk(provided: string | null): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected || !provided) return false;
  try {
    return timingSafeEqual(sha(provided), sha(expected));
  } catch {
    return false;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(req: Request): Promise<Response> {
  const authz = req.headers.get("authorization");
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : null;
  const queryToken = new URL(req.url).searchParams.get("token");
  // Prefer the header (stays out of URLs / access logs); allow ?token= for the
  // CLI's convenience.
  if (!tokenOk(bearer ?? queryToken)) return notFound();

  const metrics = await computeMetrics();
  return Response.json(metrics, {
    headers: { "cache-control": "no-store" },
  });
}
