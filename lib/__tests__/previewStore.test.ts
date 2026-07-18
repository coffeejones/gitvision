// Security + roundtrip coverage for the change-blast preview store.
// getPreview must reject any id that isn't a clean nanoid BEFORE it reaches
// path.join — otherwise a crafted id escapes the previews dir and reads gated
// data (session JSON etc.). Regression guard for the path-traversal fix.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { savePreview, getPreview } from "../previewStore";
import type { PreviewResult } from "../changeBlast/preview";

const original = process.env.CODETRAWL_DATA_DIR;
let tmp: string;

const result: PreviewResult = {
  pr: { owner: "o", repo: "r", number: 1, title: "t", baseRef: "main", headRef: "feat" },
  report: {
    hasGraphs: true,
    changedFiles: [],
    wallsTouched: [],
    loadBearingTouched: [],
    combinedDependents: 0,
    functionsAdded: 0,
    functionsRemoved: 0,
    testFilesChanged: 0,
    testsToRun: [],
    mappedTestsUpdated: 0,
    verdict: "clear",
    headline: "ok",
  },
};

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "preview-store-test-"));
  process.env.CODETRAWL_DATA_DIR = tmp;
  // A "secret" living OUTSIDE the previews dir that a traversal id would reach:
  // <tmp>/previews/../sessions/secret.json  ==  <tmp>/sessions/secret.json
  await fs.mkdir(path.join(tmp, "sessions"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "sessions", "secret.json"),
    JSON.stringify({ id: "secret", private: true }),
  );
});

afterAll(async () => {
  if (original === undefined) delete process.env.CODETRAWL_DATA_DIR;
  else process.env.CODETRAWL_DATA_DIR = original;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("previewStore", () => {
  it("round-trips a saved preview by id", async () => {
    const id = await savePreview(result);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    const got = await getPreview(id);
    expect(got?.id).toBe(id);
    expect(got?.pr.owner).toBe("o");
  });

  it("returns null for a well-formed but unknown id", async () => {
    expect(await getPreview("V1StGXR8Z5")).toBeNull();
  });

  it("rejects path-traversal ids instead of reading outside the previews dir", async () => {
    // Without the id guard, this exact string resolves to the secret above.
    expect(await getPreview("../sessions/secret")).toBeNull();
    expect(await getPreview("..%2Fsessions%2Fsecret")).toBeNull();
    expect(await getPreview("a/b")).toBeNull();
    expect(await getPreview("secret.json")).toBeNull();
    expect(await getPreview("")).toBeNull();
  });
});
