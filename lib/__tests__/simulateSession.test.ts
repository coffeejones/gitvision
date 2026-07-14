// Stage 2a: the `simulate` feature is Plus-gated, and runSimulateForSession —
// the entry point both surfaces call — recovers a cached layer and simulates, or
// degrades to a typed fallback when there's no graph / no cached layer.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { writeParseCache } from "../shadowGraph/parseCache";
import { runSimulateForSession } from "../shadowGraph/simulateSession";
import { TIER_CONFIG } from "../pricing";
import { minimumTierFor } from "../billing/gates";

describe("simulate feature gating", () => {
  it("is free-phase: unlocked on every tier (paid axis is multi-repo, not features)", () => {
    expect(TIER_CONFIG["open-case"].limits.simulate).toBe(true);
    expect(TIER_CONFIG["standing-docket"].limits.simulate).toBe(true);
    expect(TIER_CONFIG["full-bench"].limits.simulate).toBe(true);
    expect(minimumTierFor("simulate")).toBe("open-case");
  });
});

describe("runSimulateForSession", () => {
  const originalEnv = process.env.REPOBARON_DATA_DIR;
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "simsession-cache-"));
    process.env.REPOBARON_DATA_DIR = tmp;
    await javascriptPlugin.load();
  });
  afterAll(async () => {
    if (originalEnv === undefined) delete process.env.REPOBARON_DATA_DIR;
    else process.env.REPOBARON_DATA_DIR = originalEnv;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // Analyze a tree, persist its parse layer, and return a snapshot stub carrying
  // the same contentHashes — exactly what a real session hands the simulate path.
  async function analyzedSnapshot(tree: Record<string, string>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "simsession-src-"));
    for (const [rel, content] of Object.entries(tree)) {
      const full = path.join(dir, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }
    const r = await analyzeDirectory(dir, [javascriptPlugin]);
    await writeParseCache(
      {
        files: r.files,
        pluginByFile: r.pluginByFile,
        extras: r.extras,
        contentHashes: r.codeGraph.contentHashes ?? {},
      },
      { repo: "test/repo" },
    );
    await fs.rm(dir, { recursive: true, force: true });
    return { codeGraph: { contentHashes: r.codeGraph.contentHashes } };
  }

  it("simulates a change against the cached layer and returns a verdict", async () => {
    const tree: Record<string, string> = {
      "core.ts": `export function core(n: number) { return n * 2; }`,
    };
    for (let i = 0; i < 12; i++) {
      tree[`dep${i}.ts`] = `import { core } from "./core";\nexport const d${i} = core(${i});`;
    }
    const snap = await analyzedSnapshot(tree);

    const out = await runSimulateForSession(snap, [
      { path: "core.ts", newContent: `export function core(n: number) { return n * 3; }` },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.mode).toBe("patched");
      // A change to an unguarded load-bearing file surfaces required actions.
      expect(out.result.requiredActions.map((a) => a.kind)).toContain(
        "load-bearing-touched",
      );
    }
  });

  it("refuses a repo above the interactive-simulation size limit", async () => {
    const tree: Record<string, string> = {
      "a.ts": "export const a = 1;",
      "b.ts": "export const b = 2;",
      "c.ts": "export const c = 3;",
    };
    const snap = await analyzedSnapshot(tree);
    // 3 analyzed files, cap of 2 → over-limit → typed fallback, no rebuild.
    const out = await runSimulateForSession(
      snap,
      [{ path: "a.ts", newContent: "export const a = 9;" }],
      undefined,
      { maxFiles: 2 },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("too-large-to-simulate");
  });

  it("returns no-code-graph when the snapshot carries none", async () => {
    const out = await runSimulateForSession({}, []);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no-code-graph");
  });

  it("returns layer-unavailable when the file set was never cached", async () => {
    const out = await runSimulateForSession(
      { codeGraph: { contentHashes: { "ghost.ts": "deadbeef" } } },
      [{ path: "ghost.ts", newContent: "export const x = 1;" }],
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("layer-unavailable");
  });
});
