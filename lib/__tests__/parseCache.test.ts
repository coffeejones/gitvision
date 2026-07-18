// Shadow-Graph parse cache (Stage 0b): the serializer preserves Map/Set, and a
// cached parse layer rebuilds a byte-identical CodeGraph — the correctness heart
// of "cached-parse + full rebuild".

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { encodeForJson, decodeFromJson } from "../shadowGraph/serialize";
import {
  writeParseCache,
  readParseCache,
  universeDigest,
} from "../shadowGraph/parseCache";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";

describe("serialize codec", () => {
  it("round-trips Maps, Sets, and nested structures through JSON", () => {
    const original = {
      m: new Map<string, number>([["a", 1], ["b", 2]]),
      nested: new Map([["x", new Map([["y", new Set([1, 2, 3])]])]]),
      arr: [new Map([["k", "v"]]), 5, "s"],
      plain: { foo: "bar", n: null },
    };
    const wire = JSON.parse(JSON.stringify(encodeForJson(original)));
    const back = decodeFromJson(wire) as typeof original;
    expect(back.m).toBeInstanceOf(Map);
    expect(back.m.get("b")).toBe(2);
    const y = (back.nested.get("x") as Map<string, Set<number>>).get("y");
    expect(y).toBeInstanceOf(Set);
    expect([...(y as Set<number>)]).toEqual([1, 2, 3]);
    expect((back.arr[0] as Map<string, string>).get("k")).toBe("v");
    expect(back.plain).toEqual({ foo: "bar", n: null });
  });

  it("preserves Map insertion order (determinism)", () => {
    const m = new Map([["z", 1], ["a", 2], ["m", 3]]);
    const back = decodeFromJson(encodeForJson(m)) as Map<string, number>;
    expect([...back.keys()]).toEqual(["z", "a", "m"]);
  });
});

describe("parse cache round-trip", () => {
  const originalEnv = process.env.CODETRAWL_DATA_DIR;
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "parsecache-test-"));
    process.env.CODETRAWL_DATA_DIR = tmp;
    await javascriptPlugin.load();
  });
  afterAll(async () => {
    if (originalEnv === undefined) delete process.env.CODETRAWL_DATA_DIR;
    else process.env.CODETRAWL_DATA_DIR = originalEnv;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function analyzed() {
    // A small, real, multi-file subtree with cross-file imports + calls, so the
    // graph rebuild exercises real resolution.
    const dir = path.join(process.cwd(), "lib/changeBlast");
    const r = await analyzeDirectory(dir, [javascriptPlugin]);
    return {
      r,
      layer: {
        files: r.files,
        pluginByFile: r.pluginByFile,
        extras: r.extras,
        contentHashes: r.codeGraph.contentHashes ?? {},
      },
    };
  }

  it("caches the parse layer and rebuilds a byte-identical graph", async () => {
    const { r, layer } = await analyzed();
    const digest = await writeParseCache(layer, { repo: "test/repo" });
    expect(digest).toMatch(/^[a-f0-9]{32}$/);

    const back = await readParseCache(digest);
    expect(back).not.toBeNull();
    expect(back!.files.length).toBe(r.files.length);
    expect(back!.pluginByFile).toBeInstanceOf(Map);
    expect(back!.extras).toBeInstanceOf(Map);
    expect(back!.analyzerVersion).toBeDefined();

    // The heart: rebuild from the cached parse layer → identical to the original.
    // buildCodeGraph doesn't compute contentHashes (analyzeDirectory adds them
    // afterward, and the patcher re-attaches them for the patched file set); the
    // files are unchanged here, so the cached hashes are the reattachment.
    const rebuilt = buildCodeGraph({
      parsedFiles: back!.files,
      pluginByFile: back!.pluginByFile,
    });
    rebuilt.contentHashes = back!.contentHashes;
    const strip = (g: unknown) =>
      JSON.stringify({ ...(g as object), generatedAt: null });
    expect(strip(rebuilt)).toBe(strip(r.codeGraph));
  });

  it("is content-addressed: same hashes → same entry; unknown/invalid → null", async () => {
    const { r, layer } = await analyzed();
    const digest = await writeParseCache(layer);
    // A simulate looks the entry up by digesting the snapshot's contentHashes.
    expect(universeDigest(layer.contentHashes)).toBe(digest);
    const byHashes = await readParseCache(layer.contentHashes);
    expect(byHashes).not.toBeNull();
    expect(byHashes!.files.length).toBe(r.files.length);
    // Unknown but well-formed digest → null (absent).
    expect(await readParseCache("abcdef0123456789".repeat(2))).toBeNull();
    // Malformed digest → null (path guard, never touches the fs).
    expect(await readParseCache("../../etc/passwd")).toBeNull();
  });
});
