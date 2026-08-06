// Locating the stored sessions these tests read.
//
// They assert against REAL analyses on purpose — "agrees on a real session,
// not just a fixture" — so a synthetic graph would defeat the point, and the
// four they use total 61 MB (10 MB even trimmed to the fields the code reads),
// which is far too much to commit.
//
// What broke was never the data, it was the lookup: the helpers resolved
// `process.cwd()/.gitvision/sessions`, and in a git WORKTREE that is the
// worktree's own empty directory rather than the checkout where the sessions
// were captured. All 45 failures across five files were this one thing.
//
// `git rev-parse --git-common-dir` points at the main checkout's .git from
// anywhere, including a worktree, so its parent is where the sessions live.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function sessionDirs(): string[] {
  const candidates: string[] = [path.join(process.cwd(), ".gitvision", "sessions")];
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const root = path.dirname(path.resolve(process.cwd(), common));
    candidates.push(path.join(root, ".gitvision", "sessions"));
  } catch {
    // Not a git checkout — the cwd candidate is all we have.
  }
  // Every existing candidate, in order — NOT the first one. A worktree has its
  // own .gitvision holding whatever was analysed there, so "the directory
  // exists" is not the same as "the session is in it".
  return candidates.filter((d) => fs.existsSync(d));
}

const DIRS = sessionDirs();

function findFile(id: string): string | null {
  for (const d of DIRS) {
    const f = path.join(d, `${id}.json`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** True when every id is on disk. Tests gate on this rather than failing, so a
 *  machine without the captured sessions reports "skipped", not "broken". */
export function hasSessions(...ids: string[]): boolean {
  return ids.every((id) => findFile(id) !== null);
}

/** The latest snapshot of a stored session. Throws with the reason rather than
 *  an ENOENT, so a failure says what to do about it. */
export function loadSnapshot<T>(id: string): T {
  const file = findFile(id);
  if (!file) {
    throw new Error(
      `Session ${id} not found. Looked in: ${DIRS.join(", ") || "(no .gitvision/sessions anywhere)"}. ` +
        "Analyse the matching repo in the app to capture it.",
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")).snapshots.at(-1) as T;
}
