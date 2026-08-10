// Locating the stored sessions these tests read.
//
// They assert against REAL analyses on purpose — "agrees on a real session, not
// just a fixture" — so a synthetic graph would defeat the point.
//
// This header used to argue that committing them was infeasible: 61 MB raw, or
// 10 MB trimmed to the fields the code reads. Both numbers were measured
// UNCOMPRESSED, and that was the whole error — a code graph is mostly repeated
// key names and gzips about 20:1. Ten snapshots are 2.4 MB on disk. The
// rationale survived the commit that disproved it, which is how a comment
// becomes an argument against work that has already been done.
//
// Trimming was tried and rejected on its own merits, not on size: a hand-kept
// list of "fields the tests need" saved 600 KB and broke eight assertions that
// reach snapshot fields through helpers. bench/makeSessionFixtures.ts stores the
// WHOLE snapshot and says so.
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
import zlib from "node:zlib";

/** Committed, WHOLE, gzipped snapshots — the same real analyses, ten of them at
 *  roughly 250-360 KB each, so CI runs the same assertions instead of skipping
 *  them. Not trimmed: see the header.
 *  Regenerate with `npx tsx bench/makeSessionFixtures.ts`. */
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "sessions");

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

function fixtureFile(id: string): string | null {
  const f = path.join(FIXTURE_DIR, `${id}.json.gz`);
  return fs.existsSync(f) ? f : null;
}

function liveFile(id: string): string | null {
  for (const d of DIRS) {
    const f = path.join(d, `${id}.json`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** True when every id is on disk. Tests gate on this rather than failing, so a
 *  machine without the captured sessions reports "skipped", not "broken". */
export function hasSessions(...ids: string[]): boolean {
  return ids.every((id) => fixtureFile(id) !== null || liveFile(id) !== null);
}

/** The latest snapshot of a stored session. Throws with the reason rather than
 *  an ENOENT, so a failure says what to do about it. */
export function loadSnapshot<T>(id: string): T {
  // Fixture first: it is the same data, present everywhere, and does not
  // depend on which checkout the suite happens to run from.
  const fx = fixtureFile(id);
  if (fx) return JSON.parse(zlib.gunzipSync(fs.readFileSync(fx)).toString("utf-8")) as T;

  const file = liveFile(id);
  if (!file) {
    throw new Error(
      `Session ${id} has no fixture in ${FIXTURE_DIR} and is not in ` +
        `${DIRS.join(", ") || "(no .gitvision/sessions anywhere)"}. Analyse the ` +
        "matching repo to capture it, then `npx tsx bench/makeSessionFixtures.ts`.",
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")).snapshots.at(-1) as T;
}
