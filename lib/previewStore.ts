// File-based store for change-blast previews (Arc 5). A preview is the result
// of analyzing a PR's base + head — not a session, so it lives in its own
// namespace: <DATA_DIR>/previews/<id>.json. Small + short-lived; no listing or
// ownership model in v1 (an unguessable nanoid id is the only handle).

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWriteJson } from "./atomicWrite";
import type { PreviewResult } from "./changeBlast/preview";

export interface StoredPreview extends PreviewResult {
  id: string;
  createdAt: string;
}

function previewsDir(): string {
  const dataDir =
    process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "previews");
}

function previewPath(id: string): string {
  return path.join(previewsDir(), `${id}.json`);
}

export async function savePreview(result: PreviewResult): Promise<string> {
  await fs.mkdir(previewsDir(), { recursive: true });
  const id = nanoid(10);
  const stored: StoredPreview = {
    ...result,
    id,
    createdAt: new Date().toISOString(),
  };
  await atomicWriteJson(previewPath(id), stored);
  return id;
}

export async function getPreview(id: string): Promise<StoredPreview | null> {
  // Reject anything that isn't a clean nanoid BEFORE it reaches path.join —
  // otherwise `..%2Fsessions%2F<id>` escapes the previews dir and reads gated
  // session JSON. nanoid's alphabet is [A-Za-z0-9_-], so this never rejects a
  // real id.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    const raw = await fs.readFile(previewPath(id), "utf-8");
    return JSON.parse(raw) as StoredPreview;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
