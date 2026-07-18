import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getSeenMap, markSeen } from "../seen";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rj-seen-"));
  process.env.CODETRAWL_DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.CODETRAWL_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("seen store", () => {
  it("returns an empty map for an unknown user", async () => {
    expect(await getSeenMap("nobody")).toEqual({});
  });

  it("records and reads back a seen marker", async () => {
    await markSeen("u1", "sess1", "2026-06-01T00:00:00Z");
    expect(await getSeenMap("u1")).toEqual({ sess1: "2026-06-01T00:00:00Z" });
  });

  it("keeps multiple sessions independent per user", async () => {
    await markSeen("u1", "sess1", "t1");
    await markSeen("u1", "sess2", "t2");
    expect(await getSeenMap("u1")).toEqual({ sess1: "t1", sess2: "t2" });
  });

  it("isolates users from each other", async () => {
    await markSeen("u1", "sess1", "t1");
    await markSeen("u2", "sess1", "t2");
    expect(await getSeenMap("u1")).toEqual({ sess1: "t1" });
    expect(await getSeenMap("u2")).toEqual({ sess1: "t2" });
  });

  it("advances the marker when reopened at a newer snapshot", async () => {
    await markSeen("u1", "sess1", "t1");
    await markSeen("u1", "sess1", "t2");
    expect(await getSeenMap("u1")).toEqual({ sess1: "t2" });
  });

  it("sanitizes user ids that aren't filesystem-safe", async () => {
    await markSeen("../evil/../id", "sess1", "t1");
    // Round-trips under the same (sanitized) key, and stays inside seen/.
    expect(await getSeenMap("../evil/../id")).toEqual({ sess1: "t1" });
    const files = await fs.readdir(path.join(dir, "seen"));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
  });
});
