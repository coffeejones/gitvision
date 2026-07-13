// Merge Receipt persistence (G-2): issue → save → round-trip, graceful
// no-secret, and path-safe id lookups.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  issueReceipt,
  getReceipt,
  deleteReceiptsByInstallation,
  gcReceipts,
} from "../receiptStore";
import { verifyReceipt } from "../receipt";

const SECRET = "store-test-secret";

const DATA = {
  repo: "octocat/hello",
  prNumber: 7,
  headSha: "d".repeat(40),
  verdict: "high-risk" as const,
  loadBearingWalls: 2,
  filesReached: 40,
  guardingTestsTotal: 6,
  guardingTestsUpdated: 0,
  headSessionId: "sess-head",
};

describe("receipt store", () => {
  const savedDir = process.env.REPOBARON_DATA_DIR;
  const savedSecret = process.env.RECEIPT_SECRET;
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "receipts-test-"));
    process.env.REPOBARON_DATA_DIR = tmp;
    process.env.RECEIPT_SECRET = SECRET;
  });
  afterAll(async () => {
    if (savedDir === undefined) delete process.env.REPOBARON_DATA_DIR;
    else process.env.REPOBARON_DATA_DIR = savedDir;
    if (savedSecret === undefined) delete process.env.RECEIPT_SECRET;
    else process.env.RECEIPT_SECRET = savedSecret;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("issues, persists, and round-trips a verifiable receipt", async () => {
    const signed = await issueReceipt(DATA);
    expect(signed).not.toBeNull();
    expect(signed!.receipt.repo).toBe("octocat/hello");
    expect(verifyReceipt(signed!, SECRET)).toBe(true);

    const back = await getReceipt(signed!.receipt.id);
    expect(back).toEqual(signed);
  });

  it("returns null (no crash) when RECEIPT_SECRET is unset", async () => {
    delete process.env.RECEIPT_SECRET;
    try {
      expect(await issueReceipt(DATA)).toBeNull();
    } finally {
      process.env.RECEIPT_SECRET = SECRET;
    }
  });

  it("rejects unsafe / unknown ids without touching the fs", async () => {
    expect(await getReceipt("../../etc/passwd")).toBeNull();
    expect(await getReceipt("has/slash")).toBeNull();
    expect(await getReceipt("never-issued-1")).toBeNull();
  });

  it("tags a receipt with its installation and GCs only that install's on uninstall", async () => {
    const a = await issueReceipt(DATA, { installationId: 111 });
    const b = await issueReceipt({ ...DATA, prNumber: 8 }, { installationId: 222 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const removed = await deleteReceiptsByInstallation(111);
    expect(removed).toBe(1);
    expect(await getReceipt(a!.receipt.id)).toBeNull(); // install 111 → gone
    expect(await getReceipt(b!.receipt.id)).not.toBeNull(); // install 222 → survives
  });

  // Keep last: gcReceipts with a tiny cap evicts across the whole namespace.
  it("gcReceipts evicts oldest beyond the cap", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await issueReceipt({ ...DATA, prNumber: 200 + i }, { installationId: 333 });
      ids.push(s!.receipt.id);
    }
    await gcReceipts(1); // keep only the single newest across the dir
    const survivors = (await Promise.all(ids.map(getReceipt))).filter(Boolean).length;
    expect(survivors).toBeLessThanOrEqual(1);
  });
});
