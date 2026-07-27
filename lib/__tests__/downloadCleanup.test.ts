// downloadAndExtract must not leave the caller's source on disk when it fails.
//
// The temp directory is created first, then the repository archive is
// downloaded and written into it, then it is extracted. Until this test existed
// the try/catch only wrapped the extract, so a throw from the download or the
// write left tmpRoot behind — and after the write that directory holds a
// COMPLETE archive of the repository being analyzed.
//
// Nothing else catches it. lib/github.ts assigns `cleanup` from the RESULT of
// this function, so when it throws the caller holds null and its finally has
// nothing to call; there is no SIGTERM handler and no reaper over os.tmpdir(),
// so a leaked archive survives until the host clears its temp directory.
//
// The two cases below are the realistic triggers: GitHub refusing the download
// (403/404/rate limit/network) and the write failing (full disk).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { downloadAndExtract } from "../graph";

/** Temp dirs this function creates are `<tmpdir>/codetrawl-<nanoid(8)>`. */
async function codetrawlTempDirs(): Promise<string[]> {
  const entries = await fs.readdir(os.tmpdir()).catch(() => [] as string[]);
  return entries.filter((e) => e.startsWith("codetrawl-"));
}

function octokitThatFailsDownload(err: Error) {
  return {
    rest: { repos: { downloadTarballArchive: vi.fn().mockRejectedValue(err) } },
  } as unknown as Parameters<typeof downloadAndExtract>[0];
}

function octokitThatReturns(buffer: ArrayBuffer) {
  return {
    rest: {
      repos: {
        downloadTarballArchive: vi.fn().mockResolvedValue({ data: buffer }),
      },
    },
  } as unknown as Parameters<typeof downloadAndExtract>[0];
}

let before: string[] = [];

beforeEach(async () => {
  before = await codetrawlTempDirs();
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Belt and braces: remove anything this file managed to leak, so a failing
  // assertion doesn't litter the developer's machine.
  for (const dir of await codetrawlTempDirs()) {
    if (!before.includes(dir)) {
      await fs
        .rm(path.join(os.tmpdir(), dir), { recursive: true, force: true })
        .catch(() => {});
    }
  }
});

describe("downloadAndExtract — nothing is left behind on failure", () => {
  it("removes the temp directory when GitHub refuses the download", async () => {
    const boom = new Error("HttpError: Not Found");
    await expect(
      downloadAndExtract(octokitThatFailsDownload(boom), "o", "r", "main"),
    ).rejects.toThrow("Not Found");

    expect(
      await codetrawlTempDirs(),
      "a failed download left a temp directory behind",
    ).toEqual(before);
  });

  it("removes the temp directory — and the archive in it — when the write fails", async () => {
    // This is the case that matters: by the time writeFile runs, the full
    // repository archive is in memory and headed for tmpRoot.
    const writeFile = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValue(new Error("ENOSPC: no space left on device"));

    await expect(
      downloadAndExtract(
        octokitThatReturns(new ArrayBuffer(64)),
        "o",
        "r",
        "main",
      ),
    ).rejects.toThrow("ENOSPC");

    expect(writeFile).toHaveBeenCalled();
    expect(
      await codetrawlTempDirs(),
      "a failed write left the repository archive on disk",
    ).toEqual(before);
  });

  it("removes the temp directory when the archive cannot be extracted", async () => {
    // Pre-existing behaviour, pinned so the older catch isn't lost in a
    // refactor: 64 bytes of zeroes is not a valid gzip stream.
    await expect(
      downloadAndExtract(
        octokitThatReturns(new ArrayBuffer(64)),
        "o",
        "r",
        "main",
      ),
    ).rejects.toThrow();

    expect(
      await codetrawlTempDirs(),
      "a failed extract left a temp directory behind",
    ).toEqual(before);
  });
});
