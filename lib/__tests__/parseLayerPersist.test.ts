// Shadow-Graph caller-wiring (Stage 1d): the write seam (parseLayerWriter, the
// analyzeRepo `onParseLayer` callback the session-creating jobs hand in) and the
// read seam (loadLayer, keyed by a snapshot's own contentHashes) round-trip, and
// loadLayer degrades to null exactly where a simulate must fall back to a full
// re-analysis.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { universeDigest, type ParseLayer } from "../shadowGraph/parseCache";
import { parseLayerWriter, loadLayer } from "../shadowGraph/persist";

describe("parse-layer persistence seam (Stage 1d)", () => {
  const originalEnv = process.env.CODETRAWL_DATA_DIR;
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "persist-test-"));
    process.env.CODETRAWL_DATA_DIR = tmp;
    await javascriptPlugin.load();
  });
  afterAll(async () => {
    if (originalEnv === undefined) delete process.env.CODETRAWL_DATA_DIR;
    else process.env.CODETRAWL_DATA_DIR = originalEnv;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function analyzedLayer(): Promise<{
    codeGraph: import("../codeAnalysis/types").CodeGraph;
    layer: ParseLayer;
  }> {
    const dir = path.join(process.cwd(), "lib/changeBlast");
    const r = await analyzeDirectory(dir, [javascriptPlugin]);
    return {
      codeGraph: r.codeGraph,
      layer: {
        files: r.files,
        pluginByFile: r.pluginByFile,
        extras: r.extras,
        contentHashes: r.codeGraph.contentHashes ?? {},
      },
    };
  }

  it("writes via the callback and loads back by the snapshot's contentHashes", async () => {
    const { codeGraph, layer } = await analyzedLayer();

    // The exact call analyzeRepo makes: opts.onParseLayer(layer).
    const write = parseLayerWriter({ repo: "test/repo", ref: "main" });
    const digest = await write(layer);
    expect(digest).toBe(universeDigest(layer.contentHashes));

    // The exact call a simulate surface makes: loadLayer(snapshot). The snapshot
    // carries codeGraph.contentHashes — the same object the layer was keyed on.
    const back = await loadLayer({ codeGraph });
    expect(back).not.toBeNull();
    expect(back!.files.length).toBe(layer.files.length);
    expect(back!.repo).toBe("test/repo");
    expect(back!.ref).toBe("main");

    // End-to-end: the loaded layer rebuilds the same graph the write came from.
    const rebuilt = buildCodeGraph({
      parsedFiles: back!.files,
      pluginByFile: back!.pluginByFile,
    });
    rebuilt.contentHashes = back!.contentHashes;
    const strip = (g: unknown) =>
      JSON.stringify({ ...(g as object), generatedAt: null });
    expect(strip(rebuilt)).toBe(strip(codeGraph));
  });

  it("returns null when the snapshot has no code graph", async () => {
    expect(await loadLayer({})).toBeNull();
    expect(await loadLayer({ codeGraph: {} })).toBeNull();
  });

  it("returns null when the code graph carries no content hashes", async () => {
    expect(await loadLayer({ codeGraph: { contentHashes: {} } })).toBeNull();
  });

  it("returns null when the file set was never cached", async () => {
    // Well-formed hashes that were never written → cache miss, not an error.
    const uncached = { "ghost.ts": "deadbeef", "phantom.ts": "cafef00d" };
    expect(await loadLayer({ codeGraph: { contentHashes: uncached } })).toBeNull();
  });
});
