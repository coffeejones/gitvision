// Persistence for signed Merge Receipts. Mirrors lib/previewStore.ts: a durable
// JSON file per receipt under an unguessable nanoid, served without auth so the
// PR check / comment can permalink to it.

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWriteJson } from "./atomicWrite";
import {
  buildReceipt,
  ReceiptSecretMissingError,
  type ReceiptData,
  type SignedReceipt,
} from "./receipt";

function receiptDir(): string {
  const dataDir =
    process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "receipts");
}

// nanoid's alphabet — the only shape a receipt id can take. Guards the path join.
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

/** Cap the receipts namespace so an active install can't grow disk without bound.
 *  Receipts are tiny (~0.5 KB), so this is generous; oldest-mtime evicts first. */
const GC_MAX_RECEIPTS = 50_000;

/** What's on disk: the signed receipt plus the installation that produced it —
 *  metadata OUTSIDE the signature, used only for uninstall GC (so the signed
 *  payload, and thus verification, is unaffected). */
export interface StoredReceipt extends SignedReceipt {
  installationId?: number;
}

export async function saveReceipt(
  signed: SignedReceipt,
  installationId?: number,
): Promise<void> {
  // Defence-in-depth: never build a path from an id that isn't nanoid-shaped,
  // even though issueReceipt always generates one.
  if (!ID_RE.test(signed.receipt.id)) {
    throw new Error(`unsafe receipt id: ${signed.receipt.id}`);
  }
  await fs.mkdir(receiptDir(), { recursive: true });
  const stored: StoredReceipt =
    installationId !== undefined ? { ...signed, installationId } : signed;
  await atomicWriteJson(
    path.join(receiptDir(), `${signed.receipt.id}.json`),
    stored,
  );
}

export async function getReceipt(id: string): Promise<SignedReceipt | null> {
  if (!ID_RE.test(id)) return null; // path-safety before touching the fs
  try {
    const raw = await fs.readFile(
      path.join(receiptDir(), `${id}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as SignedReceipt;
  } catch {
    return null; // missing / unreadable → not found
  }
}

/** Build, sign, and persist a receipt for a gated PR. Returns null (never throws)
 *  when RECEIPT_SECRET isn't configured, so the Gate still posts its check +
 *  comment — just without a receipt link. Tags the file with the installation so
 *  installation.deleted can GC it, mirroring session GC. */
export async function issueReceipt(
  data: Omit<ReceiptData, "version" | "issuedAt" | "id">,
  opts: { installationId?: number } = {},
): Promise<SignedReceipt | null> {
  try {
    const signed = buildReceipt({ id: nanoid(12), ...data });
    await saveReceipt(signed, opts.installationId);
    void gcReceipts().catch(() => {}); // best-effort, never blocks issuance
    return signed;
  } catch (err) {
    if (err instanceof ReceiptSecretMissingError) return null;
    throw err;
  }
}

/** Delete every receipt an installation produced — the uninstall path, so a repo
 *  owner who removes the App stops having their PR/commit metadata served from
 *  /r/[id]. Best-effort; returns the count removed. */
export async function deleteReceiptsByInstallation(
  installationId: number,
): Promise<number> {
  let names: string[];
  try {
    names = (await fs.readdir(receiptDir())).filter((n) => n.endsWith(".json"));
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const name of names) {
    const file = path.join(receiptDir(), name);
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf-8")) as StoredReceipt;
      if (raw?.installationId === installationId) {
        await fs.unlink(file);
        deleted++;
      }
    } catch {
      /* unreadable / raced deletion — skip */
    }
  }
  return deleted;
}

/** Evict oldest-mtime receipts once the namespace exceeds the cap. Best-effort;
 *  safe to call concurrently. */
export async function gcReceipts(maxFiles = GC_MAX_RECEIPTS): Promise<void> {
  let names: string[];
  try {
    names = (await fs.readdir(receiptDir())).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  if (names.length <= maxFiles) return;
  const stats: { file: string; mtime: number }[] = [];
  for (const name of names) {
    const file = path.join(receiptDir(), name);
    try {
      const st = await fs.stat(file);
      stats.push({ file, mtime: st.mtimeMs });
    } catch {
      /* raced — ignore */
    }
  }
  stats.sort((a, b) => a.mtime - b.mtime); // oldest first
  const overflow = stats.length - maxFiles;
  for (let i = 0; i < overflow; i++) {
    await fs.unlink(stats[i].file).catch(() => {});
  }
}
