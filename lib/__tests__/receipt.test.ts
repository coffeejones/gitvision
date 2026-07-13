// Merge Receipt crypto (G-2): HMAC sign → verify, tamper detection, canonical
// stability, and graceful missing-secret handling.

import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  verifyReceipt,
  ReceiptSecretMissingError,
  type ReceiptData,
  type SignedReceipt,
} from "../receipt";

const SECRET = "test-receipt-secret";
const ISSUED = "2026-07-12T00:00:00.000Z";

const DATA: Omit<ReceiptData, "version" | "issuedAt"> = {
  id: "abc123def456",
  repo: "octocat/hello",
  prNumber: 7,
  headSha: "c".repeat(40),
  verdict: "review",
  loadBearingWalls: 1,
  filesReached: 15,
  guardingTestsTotal: 6,
  guardingTestsUpdated: 0,
  headSessionId: "sess-head",
};

const signed = () => buildReceipt(DATA, { secret: SECRET, issuedAt: ISSUED });

describe("merge receipt crypto", () => {
  it("signs and verifies a receipt", () => {
    const s = signed();
    expect(s.receipt.version).toBe(1);
    expect(s.receipt.issuedAt).toBe(ISSUED);
    expect(verifyReceipt(s, SECRET)).toBe(true);
  });

  it("rejects a tampered receipt (verdict flipped)", () => {
    const s = signed();
    const tampered: SignedReceipt = {
      ...s,
      receipt: { ...s.receipt, verdict: "clear" },
    };
    expect(verifyReceipt(tampered, SECRET)).toBe(false);
  });

  it("rejects verification under the wrong secret", () => {
    expect(verifyReceipt(signed(), "not-the-secret")).toBe(false);
  });

  it("is canonical — signature survives receipt key reordering", () => {
    const s = signed();
    const reordered = Object.fromEntries(
      Object.entries(s.receipt).reverse(),
    ) as unknown as ReceiptData;
    expect(verifyReceipt({ receipt: reordered, signature: s.signature }, SECRET)).toBe(true);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifyReceipt({ receipt: signed().receipt, signature: "zz" }, SECRET)).toBe(false);
    expect(verifyReceipt({ receipt: signed().receipt, signature: "" }, SECRET)).toBe(false);
  });

  it("throws ReceiptSecretMissingError when no secret is available", () => {
    const saved = process.env.RECEIPT_SECRET;
    delete process.env.RECEIPT_SECRET;
    try {
      expect(() => buildReceipt(DATA)).toThrow(ReceiptSecretMissingError);
      // verify degrades to false rather than throwing
      expect(verifyReceipt(signed())).toBe(false);
    } finally {
      if (saved !== undefined) process.env.RECEIPT_SECRET = saved;
    }
  });
});
