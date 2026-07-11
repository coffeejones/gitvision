// runPatch DoS pre-gate (Stage 1b): oversized payloads are rejected as
// "too-large" BEFORE any tree-sitter parse blocks the event loop; well-formed
// changes pass through to the patch engine.

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { runPatch } from "../shadowGraph/runPatch";
import type { ParseLayer } from "../shadowGraph/parseCache";

const JS = [javascriptPlugin];

describe("runPatch DoS gate", () => {
  let layer: ParseLayer;

  beforeAll(async () => {
    await javascriptPlugin.load();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runpatch-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const a = 1;");
    const r = await analyzeDirectory(dir, JS);
    layer = {
      files: r.files,
      pluginByFile: r.pluginByFile,
      extras: r.extras,
      contentHashes: r.codeGraph.contentHashes ?? {},
    };
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("passes a small valid change through to the engine", async () => {
    const r = await runPatch(layer, [{ path: "a.ts", newContent: "export const a = 2;" }], JS);
    expect(r.mode).toBe("patched");
    expect(r.graph).toBeDefined();
  });

  it("rejects a single oversized file before parsing", async () => {
    const big = "x".repeat(300 * 1024); // > 256KB default
    const r = await runPatch(layer, [{ path: "b.ts", newContent: `export const b = "${big}";` }], JS);
    expect(r.mode).toBe("too-large");
    expect(r.reason).toMatch(/b\.ts/);
  });

  it("rejects an over-budget cumulative payload", async () => {
    const chunk = "y".repeat(200 * 1024); // 3 x 200KB = 600KB > 512KB cumulative
    const changes = [1, 2, 3].map((n) => ({
      path: `c${n}.ts`,
      newContent: `export const c${n} = "${chunk}";`,
    }));
    const r = await runPatch(layer, changes, JS);
    expect(r.mode).toBe("too-large");
    expect(r.reason).toMatch(/cumulative/);
  });

  it("rejects too many changes", async () => {
    const changes = Array.from({ length: 201 }, (_, i) => ({
      path: `f${i}.ts`,
      newContent: `export const f = ${i};`,
    }));
    const r = await runPatch(layer, changes, JS);
    expect(r.mode).toBe("too-large");
    expect(r.reason).toMatch(/too many/);
  });

  it("honors custom limits", async () => {
    const r = await runPatch(
      layer,
      [{ path: "a.ts", newContent: "export const a = " + "1".repeat(2000) + ";" }],
      JS,
      { maxFileBytes: 1024 },
    );
    expect(r.mode).toBe("too-large");
  });
});
