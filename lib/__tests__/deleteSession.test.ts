// Deleting an analysis must delete the records keyed to it.
//
// deleteSession used to unlink the session file and stop, which left
// <DATA_DIR>/freshness/<sessionId>.json behind — the last commit sha we saw on
// that repository. "Delete this analysis" quietly keeping a note about the repo
// it came from is not what the word means, and it is the sort of thing a
// security page has to either fix or confess.
//
// What deliberately survives is asserted too, so the limitation stays a
// decision rather than drifting into an accident: the content-addressed parse
// index is shared between any sessions with identical file contents, so
// unlinking it here could pull the layer out from under an unrelated analysis.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSession, deleteSession, getSession } from "../storage";

let dataDir: string;
let prevDataDir: string | undefined;

const initialSnapshot = {
  fetchedAt: "2026-01-01T00:00:00.000Z",
  repo: { fullName: "acme/app" },
} as unknown as Parameters<typeof createSession>[0]["initialSnapshot"];

/** Minimal valid params — the fields deleteSession cares about are the id it
 *  gets back and the files written under DATA_DIR. */
function newSession() {
  return createSession({
    repoUrl: "https://github.com/acme/app",
    name: "acme/app",
    initialSnapshot,
  });
}

beforeEach(async () => {
  prevDataDir = process.env.CODETRAWL_DATA_DIR;
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-delete-test-"));
  process.env.CODETRAWL_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.CODETRAWL_DATA_DIR;
  else process.env.CODETRAWL_DATA_DIR = prevDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
});

/** Stand in for a freshness record written by a previous visit. */
async function writeFreshness(sessionId: string) {
  const dir = path.join(dataDir, "freshness");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({ checkedAt: 1, sha: "deadbeef" }),
  );
}

async function exists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

describe("deleteSession", () => {
  it("removes the freshness record keyed to the session", async () => {
    const session = await newSession();
    await writeFreshness(session.id);
    const freshFile = path.join(dataDir, "freshness", `${session.id}.json`);
    expect(await exists(freshFile)).toBe(true);

    expect(await deleteSession(session.id)).toBe(true);

    expect(await getSession(session.id)).toBeNull();
    expect(
      await exists(freshFile),
      "the last commit sha we saw survived the deletion",
    ).toBe(false);
  });

  it("reports false and touches nothing for an id that is not there", async () => {
    await writeFreshness("not-a-session");

    expect(await deleteSession("not-a-session")).toBe(false);

    // The freshness unlink runs only after the session file is gone, so a
    // miss must not quietly delete an unrelated record.
    expect(
      await exists(path.join(dataDir, "freshness", "not-a-session.json")),
    ).toBe(true);
  });

  it("leaves the shared parse index alone — it is not session-scoped", async () => {
    // Content-addressed and shared: two sessions over identical file contents
    // resolve to the same digest, so deleting one must not evict the layer.
    const session = await newSession();
    const cacheDir = path.join(dataDir, "parsecache");
    await fs.mkdir(cacheDir, { recursive: true });
    const layer = path.join(cacheDir, "abcdef0123456789.json.gz");
    await fs.writeFile(layer, "layer");

    await deleteSession(session.id);

    expect(await exists(layer)).toBe(true);
  });
});
