// Turn the flat list of analyzed file paths (the keys of codeGraph.contentHashes)
// into a nested tree for the Source view's file explorer. Pure + deterministic —
// no new data, just a reshape of paths we already have.

import { cmpStr } from "./deterministicSort";

export interface TreeFile {
  type: "file";
  name: string;
  path: string;
}
export interface TreeDir {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}
export type TreeNode = TreeFile | TreeDir;

/** Build a nested tree from posix-style relative paths. Directories sort before
 *  files; both alphabetical (case-insensitive) within a level. */
export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeDir = { type: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, TreeDir>([["", root]]);

  for (const path of paths) {
    const segs = path.split("/");
    let parent = root;
    let prefix = "";
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      prefix = prefix ? `${prefix}/${seg}` : seg;
      if (i === segs.length - 1) {
        parent.children.push({ type: "file", name: seg, path });
      } else {
        let dir = dirs.get(prefix);
        if (!dir) {
          dir = { type: "dir", name: seg, path: prefix, children: [] };
          dirs.set(prefix, dir);
          parent.children.push(dir);
        }
        parent = dir;
      }
    }
  }

  sortLevel(root);
  return root.children;
}

function sortLevel(dir: TreeDir): void {
  dir.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    // Case-insensitive, but locale-independent (see deterministicSort).
    return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.name, b.name);
  });
  for (const child of dir.children) {
    if (child.type === "dir") sortLevel(child);
  }
}

/** Directory paths that should start expanded — the chain down to the first
 *  file, so the tree never opens fully collapsed with nothing visible. */
export function defaultExpanded(nodes: TreeNode[]): Set<string> {
  const open = new Set<string>();
  let level = nodes;
  // Walk down the first directory chain until we hit a level with a file.
  while (level.length > 0) {
    const firstDir = level.find((n): n is TreeDir => n.type === "dir");
    const hasFile = level.some((n) => n.type === "file");
    if (hasFile || !firstDir) break;
    open.add(firstDir.path);
    level = firstDir.children;
  }
  return open;
}
