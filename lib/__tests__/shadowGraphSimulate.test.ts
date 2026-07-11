// Verdict layer (Stage 1c): simulateChange turns a patched graph into a
// ChangeBlastReport + grounded requiredActions (the agent-conscience signal).

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { simulateChange } from "../shadowGraph/simulate";
import type { ParseLayer } from "../shadowGraph/parseCache";
import type { FileChange } from "../shadowGraph/patch";

const JS = [javascriptPlugin];

// core.ts is imported + called by 12 files → a load-bearing wall. No test guards it.
function loadBearingRepo(): Record<string, string> {
  const tree: Record<string, string> = {
    "core.ts": `export function core(n: number) { return n * 2; }`,
  };
  for (let i = 0; i < 12; i++) {
    tree[`dep${i}.ts`] = `import { core } from "./core";\nexport const d${i} = core(${i});`;
  }
  return tree;
}

async function layerOf(tree: Record<string, string>): Promise<{ layer: ParseLayer; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-sim-"));
  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  const r = await analyzeDirectory(dir, JS);
  return {
    layer: {
      files: r.files,
      pluginByFile: r.pluginByFile,
      extras: r.extras,
      contentHashes: r.codeGraph.contentHashes ?? {},
    },
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

async function sim(tree: Record<string, string>, changes: FileChange[]) {
  const { layer, cleanup } = await layerOf(tree);
  try {
    return await simulateChange(layer, changes, JS);
  } finally {
    await cleanup();
  }
}

describe("simulateChange verdict layer", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  it("flags an unguarded load-bearing wall touched by the diff", async () => {
    const r = await sim(loadBearingRepo(), [
      { path: "core.ts", newContent: `export function core(n: number) { return n * 3; }` },
    ]);
    expect(r.mode).toBe("patched");
    expect(r.report!.loadBearingTouched).toContain("core.ts");
    const kinds = r.requiredActions.map((a) => a.kind);
    expect(kinds).toContain("load-bearing-touched");
    expect(kinds).toContain("no-guarding-tests");
    // the load-bearing action carries its receipts
    const wall = r.requiredActions.find((a) => a.kind === "load-bearing-touched")!;
    expect(wall.severity).toBe("high");
    expect(wall.evidence.numbers?.dependentsReached).toBeGreaterThan(0);
  });

  it("lists the dependent files a delete actually reaches (affectedFiles)", async () => {
    const r = await sim(loadBearingRepo(), [
      { path: "core.ts", newContent: null }, // delete the load-bearing file
    ]);
    expect(r.mode).toBe("patched");
    // All 12 deps import core.ts → all reached, none guarded (no test files).
    expect(r.affectedFiles).toHaveLength(12);
    expect(r.affectedFiles.map((a) => a.path)).toContain("dep0.ts");
    expect(r.affectedFiles.every((a) => a.untested)).toBe(true);
    expect(r.affectedFiles.every((a) => a.hop === 1)).toBe(true);
  });

  it("flags a hollow test case added by the diff", async () => {
    const r = await sim(loadBearingRepo(), [
      // A new test file whose only case asserts nothing meaningful.
      { path: "smoke.test.ts", newContent: `it("runs", () => { const x = 1 + 1; });` },
    ]);
    expect(r.mode).toBe("patched");
    const hollow = r.requiredActions.find((a) => a.kind === "hollow-tests-added");
    expect(hollow).toBeDefined();
    expect(hollow!.evidence.numbers?.newSmokeOnlyCases).toBe(1);
  });

  it("flags a new structural duplicate introduced by the diff", async () => {
    // Complexity must clear findDuplicateGroups' minComplexity floor (5) — the
    // product's tuned threshold, which the verdict layer reuses.
    const body = `export function process(items: number[]) {
  let total = 0;
  for (const it of items) {
    if (it > 10) { total += it * 2; }
    else if (it > 5) { total += it; }
    else if (it > 0) { total -= it; }
    else if (it < -5) { total *= 2; }
    else { total = 0; }
  }
  return total;
}`;
    const base = { "a.ts": body };
    // b.ts adds a byte-identical body → a new duplicate group.
    const r = await sim(base, [{ path: "b.ts", newContent: body }]);
    expect(r.mode).toBe("patched");
    expect(r.requiredActions.some((a) => a.kind === "new-duplicate")).toBe(true);
  });

  it("returns a clean verdict with no actions when the change is contained + guarded", async () => {
    const base = {
      "util.ts": `export function fmt(s: string) { return s.trim(); }`,
      "util.test.ts": `import { fmt } from "./util";\nit("trims", () => { expect(fmt(" a ")).toBe("a"); });`,
    };
    const r = await sim(base, [
      { path: "util.ts", newContent: `export function fmt(s: string) { return s.trimStart(); }` },
    ]);
    expect(r.mode).toBe("patched");
    // A safe, non-load-bearing edit → no required actions.
    expect(r.requiredActions).toEqual([]);
  });

  it("propagates a non-patched mode with no actions", async () => {
    const r = await sim({ "a.ts": `export const a = 1;` }, [
      { path: "package.json", newContent: `{"name":"x"}` },
    ]);
    expect(r.mode).toBe("needs-full-analysis");
    expect(r.requiredActions).toEqual([]);
  });
});
