// POST /api/receipts/verify — the trustless verify path for a Merge Receipt.
// Give it a full { receipt, signature } (copied from a PR, a receipt page, or
// anywhere) and it recomputes the HMAC and reports whether CodeTrawl issued it,
// untampered. No auth — verifiability is the point.

import { NextResponse } from "next/server";
import { verifyReceipt, type SignedReceipt } from "@/lib/receipt";

export const dynamic = "force-dynamic";

// A receipt is ~0.5 KB; 64 KB is generous. Reject an oversized body by its
// declared length before buffering it — this endpoint is public + unauthenticated,
// so it's an easy memory-exhaustion target otherwise.
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  const body = (await req.json().catch(() => null)) as SignedReceipt | null;
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.receipt !== "object" ||
    body.receipt === null ||
    typeof body.signature !== "string"
  ) {
    return NextResponse.json(
      { error: "Expected a JSON body of the form { receipt, signature }." },
      { status: 400 },
    );
  }

  const valid = verifyReceipt(body);
  return NextResponse.json({
    valid,
    verdict: body.receipt.verdict,
    repo: body.receipt.repo,
    prNumber: body.receipt.prNumber,
    headSha: body.receipt.headSha,
    issuedAt: body.receipt.issuedAt,
  });
}
