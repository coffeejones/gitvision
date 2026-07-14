import { describe, it, expect } from "vitest";
import { buildFileTree, defaultExpanded, type TreeDir } from "../fileTree";

describe("buildFileTree", () => {
  it("nests paths into directories and files", () => {
    const tree = buildFileTree(["src/a.ts", "src/util/b.ts", "README.md"]);
    // Directories sort before files: src/ then README.md
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(["dir:src", "file:README.md"]);
    const src = tree[0] as TreeDir;
    // Within src: util/ (dir) before a.ts (file)
    expect(src.children.map((n) => `${n.type}:${n.name}`)).toEqual(["dir:util", "file:a.ts"]);
    const util = src.children[0] as TreeDir;
    expect(util.children).toEqual([{ type: "file", name: "b.ts", path: "src/util/b.ts" }]);
  });

  it("keeps full paths on files (for the fetch) and prefixes on dirs", () => {
    const tree = buildFileTree(["a/b/c.ts"]);
    const a = tree[0] as TreeDir;
    expect(a.path).toBe("a");
    const b = a.children[0] as TreeDir;
    expect(b.path).toBe("a/b");
    expect(b.children[0]).toMatchObject({ type: "file", path: "a/b/c.ts" });
  });

  it("sorts case-insensitively", () => {
    const tree = buildFileTree(["Zebra.ts", "apple.ts"]);
    expect(tree.map((n) => n.name)).toEqual(["apple.ts", "Zebra.ts"]);
  });

  it("handles an empty file set", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe("defaultExpanded", () => {
  it("opens the directory chain down to the first file", () => {
    const tree = buildFileTree(["src/main/java/App.java"]);
    expect([...defaultExpanded(tree)].sort()).toEqual(["src", "src/main", "src/main/java"]);
  });

  it("stops at the first level that already holds a file", () => {
    const tree = buildFileTree(["src/a.ts", "src/deep/b.ts"]);
    expect([...defaultExpanded(tree)]).toEqual(["src"]);
  });

  it("returns empty when a file sits at the root", () => {
    const tree = buildFileTree(["index.ts"]);
    expect(defaultExpanded(tree).size).toBe(0);
  });
});
