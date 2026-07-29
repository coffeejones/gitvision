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

/** Write JSON to disk atomically. Temp file lives next to the target so the
 *  rename stays on the same filesystem (rename across filesystems is not
 *  atomic).
 *
 *  Indented by default, because most of what goes through here is small enough
 *  to read with `cat` and AGENTS.md calls the storage "inspectable" on purpose:
 *  a job is a few hundred bytes, a feedback entry less.
 *
 *  `compact` drops the indent, and sessions use it. Measured on the stored
 *  colinhacks/zod analysis: 55.3 MB indented, 33.8 MB compact — 21.5 MB of the
 *  file, 39%, was whitespace. Reading and parsing it went 118ms → 55ms (the
 *  read alone 57ms → 9ms), which showed up as 14-24% off every session page.
 *  Nothing is lost but the indent: same JSON, same shape, and the AGENTS.md
 *  command for eyeballing a session already pipes it through json.tool because
 *  a 30 MB file was never readable by eye either way. */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  opts: { compact?: boolean } = {}
): Promise<void> {
  await atomicWriteBuffer(
    filePath,
    Buffer.from(
      opts.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2),
      "utf-8"
    )
  );
}

/** Atomic binary write (temp + rename). Used for gzipped artifacts like the
 *  Shadow-Graph parse cache where the payload isn't human-readable JSON. */
export async function atomicWriteBuffer(
  filePath: string,
  data: Buffer | Uint8Array
): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${nanoid(4)}`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Rename failed — clean up the temp file so we don't leak it. Don't
    // mask the original error.
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
