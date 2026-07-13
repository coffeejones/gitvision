// Merge Receipt (G-2) — a signed, verifiable record that the deterministic Gate
// ran on an exact commit. "Computed, never generated" applied to PR trust: a
// third party can confirm CodeTrawl issued this verdict for this head SHA, not a
// fabricated screenshot.
//
// v1 signs with HMAC-SHA256 over a canonicalized payload (sorted keys → stable
// signature regardless of serialization order). RECEIPT_SECRET is the key;
// verification is via our /api/receipts/verify endpoint. A future v2 could sign
// with the app's RSA key for public-key ("trustless") verification.

import { createHmac, timingSafeEqual } from "node:crypto";

export type ReceiptVerdict = "clear" | "review" | "high-risk";

export interface ReceiptData {
  version: 1;
  /** Permalink key (nanoid). */
  id: string;
  /** "owner/name". */
  repo: string;
  prNumber: number;
  /** The exact commit the Gate ran on — the anchor of the whole receipt. */
  headSha: string;
  verdict: ReceiptVerdict;
  loadBearingWalls: number;
  filesReached: number;
  guardingTestsTotal: number;
  guardingTestsUpdated: number;
  /** The public analysis this verdict came from. */
  headSessionId: string;
  issuedAt: string; // ISO 8601
}

export interface SignedReceipt {
  receipt: ReceiptData;
  /** hex HMAC-SHA256 over the canonical receipt. */
  signature: string;
}

/** Missing-secret is distinguishable so callers can degrade gracefully (issue no
 *  receipt) rather than crash the PR path. */
export class ReceiptSecretMissingError extends Error {
  constructor() {
    super("RECEIPT_SECRET is not configured");
    this.name = "ReceiptSecretMissingError";
  }
}

function secret(override?: string): string {
  const s = override ?? process.env.RECEIPT_SECRET;
  if (!s) throw new ReceiptSecretMissingError();
  return s;
}

/** Stable serialization: sort keys so signature is independent of property order
 *  (all values are primitives, so a top-level sort is sufficient). */
function canonical(r: ReceiptData): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(r).sort()) {
    sorted[k] = (r as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(sorted);
}

export function signReceipt(r: ReceiptData, secretOverride?: string): string {
  return createHmac("sha256", secret(secretOverride)).update(canonical(r)).digest("hex");
}

/** Build + sign a receipt. Stamps version + issuedAt (unless provided, for
 *  deterministic tests). Throws ReceiptSecretMissingError if no secret. */
export function buildReceipt(
  data: Omit<ReceiptData, "version" | "issuedAt">,
  opts: { issuedAt?: string; secret?: string } = {},
): SignedReceipt {
  const receipt: ReceiptData = {
    version: 1,
    ...data,
    issuedAt: opts.issuedAt ?? new Date().toISOString(),
  };
  return { receipt, signature: signReceipt(receipt, opts.secret) };
}

/** Constant-time verify that a signed receipt was issued by us and untampered. */
export function verifyReceipt(signed: SignedReceipt, secretOverride?: string): boolean {
  let expected: string;
  try {
    expected = signReceipt(signed.receipt, secretOverride);
  } catch {
    return false; // no secret → can't verify → treat as invalid
  }
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(typeof signed.signature === "string" ? signed.signature : "", "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
