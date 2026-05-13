// Atomic JSON writes — write to a sibling temp file, then rename into place.
// POSIX rename is atomic on the same filesystem, which is what we have for
// all on-disk session/job/feedback storage. Readers (polling, listing, GETs)
// can never see a half-written file with this pattern; without it, a kill or
// container restart mid-write leaves a corrupt JSON that crashes the next
// read.
//
// Extracted from inline copies in lib/jobs.ts and lib/feedback.ts so a single
// implementation governs every on-disk write. lib/storage.ts was the third
// caller — it had been using plain fs.writeFile, which produced the corrupt-
// session-on-redeploy bug fixed in this commit.

import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";

/** Write JSON to disk atomically. Serializes with 2-space indent so the
 *  result is human-readable when inspecting on disk. Temp file lives next to
 *  the target so the rename stays on the same filesystem (rename across
 *  filesystems is not atomic). */
export async function atomicWriteJson(
  filePath: string,
  data: unknown
): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${nanoid(4)}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Rename failed — clean up the temp file so we don't leak it. Don't
    // mask the original error.
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
