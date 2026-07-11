// Golden-equivalence matrix for the Shadow-Graph patch engine (Stage 1) — the
// correctness net. For each change, patch(base-layer, change) must produce a
// CodeGraph byte-identical to a from-scratch analysis of the mutated tree. Every
// case is a cross-file coupling a naive incremental engine silently gets wrong.

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { pythonPlugin } from "../codeAnalysis/plugins/python";
import type { CodeAnalysisPlugin } from "../codeAnalysis/types";
import { patch, type FileChange } from "../shadowGraph/patch";
import { djb2 } from "../codeAnalysis/fileUniverse";

type Tree = Record<string, string>;

async function writeTree(dir: string, tree: Tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

function applyChange(tree: Tree, change: FileChange): Tree {
  const out = { ...tree };
  if (change.newContent === null) delete out[change.path];
  else out[change.path] = change.newContent;
  return out;
}

const strip = (g: unknown) =>
  JSON.stringify({ ...(g as object), generatedAt: null });

/** Run one golden case: patch the base layer, full-analyze the mutated tree,
 *  return both graphs (stripped strings) + the patch mode. */
async function run(base: Tree, change: FileChange, plugins: CodeAnalysisPlugin[]) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-base-"));
  const mutDir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-mut-"));
  try {
    await writeTree(baseDir, base);
    const analyzed = await analyzeDirectory(baseDir, plugins);
    const layer = {
      files: analyzed.files,
      pluginByFile: analyzed.pluginByFile,
      extras: analyzed.extras,
      contentHashes: analyzed.codeGraph.contentHashes ?? {},
    };
    const result = patch(layer, [change], plugins);

    await writeTree(mutDir, applyChange(base, change));
    const full = await analyzeDirectory(mutDir, plugins);

    return {
      mode: result.mode,
      approximations: result.approximations,
      patched: result.graph ? strip(result.graph) : null,
      full: strip(full.codeGraph),
      base: strip(analyzed.codeGraph),
    };
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
    await fs.rm(mutDir, { recursive: true, force: true });
  }
}

const JS = [javascriptPlugin];

describe("Shadow-Graph golden equivalence (JS/TS)", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
    await pythonPlugin.load();
  });

  it("content edit (no path-set change)", async () => {
    const base: Tree = {
      "a.ts": `export function add(x: number, y: number) { return x + y; }`,
      "b.ts": `import { add } from "./a";\nexport function sum() { return add(1, 2); }`,
    };
    const r = await run(base, {
      path: "a.ts",
      newContent: `export function add(x: number, y: number) {\n  const z = x + y;\n  return z;\n}`,
    }, JS);
    expect(r.mode).toBe("patched");
    expect(r.patched).toBe(r.full);
  });

  it("add a file that SHADOWS an existing resolution (foo.ts over foo.js)", async () => {
    const base: Tree = {
      "foo.js": `export function foo() { return 1; }`,
      "bar.ts": `import { foo } from "./foo";\nexport const x = foo();`,
    };
    // Adding foo.ts re-routes bar's `./foo` from foo.js to foo.ts (TS-first) —
    // bar didn't change, but its import edge must.
    const r = await run(base, {
      path: "foo.ts",
      newContent: `export function foo() { return 2; }`,
    }, JS);
    expect(r.mode).toBe("patched");
    expect(r.base).not.toBe(r.full); // the add actually re-routed bar's import
    expect(r.patched).toBe(r.full);
  });

  it("delete a file that RE-ROUTES an import (foo.ts → foo/index.ts)", async () => {
    const base: Tree = {
      "foo.ts": `export function foo() { return 1; }`,
      "foo/index.ts": `export function foo() { return 9; }`,
      "bar.ts": `import { foo } from "./foo";\nexport const x = foo();`,
    };
    const r = await run(base, { path: "foo.ts", newContent: null }, JS);
    expect(r.mode).toBe("patched");
    expect(r.base).not.toBe(r.full); // the delete actually re-routed bar's import
    expect(r.patched).toBe(r.full);
  });

  it("add a 2nd same-named function (flips a single-candidate call in an UNRELATED file)", async () => {
    const base: Tree = {
      "a.ts": `export function helper() { return 1; }`,
      // bare call — resolves to a.helper by single-candidate match
      "b.ts": `export function use() { return helper(); }`,
    };
    const r = await run(base, {
      path: "c.ts",
      newContent: `export function helper() { return 2; }`,
    }, JS);
    expect(r.mode).toBe("patched");
    expect(r.base).not.toBe(r.full); // b's bare call lost its single-candidate binding
    expect(r.patched).toBe(r.full);
  });

  it("add a colliding class name (repo-wide disambiguation suffixes)", async () => {
    const base: Tree = {
      "a.ts": `export class Props { a = 1; }`,
      "b.ts": `export class Widget { render() { return 1; } }`,
    };
    const r = await run(base, {
      path: "c.ts",
      newContent: `export class Props { b = 2; }`,
    }, JS);
    expect(r.mode).toBe("patched");
    expect(r.base).not.toBe(r.full); // a.ts's Props got a disambiguation suffix
    expect(r.patched).toBe(r.full);
  });

  it("rename a file (delete + add in one change set)", async () => {
    const base: Tree = {
      "old.ts": `export function thing() { return 1; }`,
      "user.ts": `import { thing } from "./old";\nexport const y = thing();`,
    };
    // Simulate the delete half here (the add of new.ts + user re-point would be
    // a two-change set; this asserts the delete path re-routes user to unresolved).
    const r = await run(base, { path: "old.ts", newContent: null }, JS);
    expect(r.mode).toBe("patched");
    expect(r.patched).toBe(r.full);
  });

  it("edit a test file (Weak-Suite / testMeta delta)", async () => {
    const base: Tree = {
      "m.ts": `export function m(x: number) { return x * 2; }`,
      "m.test.ts": `import { m } from "./m";\nit("works", () => { expect(m(2)).toBeDefined(); });`,
    };
    const r = await run(base, {
      path: "m.test.ts",
      newContent: `import { m } from "./m";\nit("works", () => { expect(m(2)).toBe(4); });`,
    }, JS);
    expect(r.mode).toBe("patched");
    expect(r.patched).toBe(r.full);
  });

  it("modify a file into minified content (universe exclusion → treated as delete)", async () => {
    const base: Tree = {
      "keep.ts": `export function keep() { return 1; }`,
      "gen.ts": `export function gen() { return 2; }`,
    };
    // A 60KB single-line blob passes the size cap but fails looksMinifiedByContent
    // → full analysis excludes it, so the patch must drop it too.
    const minified = "const x=" + "1+".repeat(30000) + "1;";
    const r = await run(base, { path: "gen.ts", newContent: minified }, JS);
    expect(r.mode).toBe("patched");
    expect(r.patched).toBe(r.full);
  });
});

describe("Shadow-Graph routing (non-JS / config / base)", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
    await pythonPlugin.load();
  });

  it("declares an approximation when a non-JS file is touched", async () => {
    const base: Tree = {
      "app.py": `def app():\n    return 1\n`,
      "util.py": `def util():\n    return 2\n`,
    };
    const r = await run(base, {
      path: "app.py",
      newContent: `def app():\n    return util()\n`,
    }, [javascriptPlugin, pythonPlugin]);
    expect(r.mode).toBe("patched");
    expect(r.approximations.join(" ")).toMatch(/frozen at base/);
    expect(r.approximations.join(" ")).toMatch(/python/);
  });

  it("routes a build-config edit to full re-analysis", async () => {
    const base: Tree = { "a.ts": `export const a = 1;` };
    const r = await run(base, { path: "package.json", newContent: `{"name":"x"}` }, JS);
    expect(r.mode).toBe("needs-full-analysis");
  });

  it("rejects a base-content mismatch instead of judging the wrong base", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-bm-"));
    try {
      await writeTree(baseDir, { "a.ts": `export const a = 1;` });
      const analyzed = await analyzeDirectory(baseDir, JS);
      const layer = {
        files: analyzed.files,
        pluginByFile: analyzed.pluginByFile,
        extras: analyzed.extras,
        contentHashes: analyzed.codeGraph.contentHashes ?? {},
      };
      const r = patch(
        layer,
        [{ path: "a.ts", newContent: `export const a = 2;`, baseHash: djb2("WRONG BASE") }],
        JS,
      );
      expect(r.mode).toBe("base-mismatch");
      expect(r.baseMismatch).toEqual(["a.ts"]);
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
