// Regenerate the committed test fixtures from live captured sessions.
//
//   npx tsx bench/makeSessionFixtures.ts
//
// The brief and coverage tests assert against REAL analyses on purpose. Live
// sessions live in .gitvision/sessions, which is gitignored and machine-local,
// so CI saw nothing and 45 tests either failed or skipped.
//
// A snapshot is 4-35 MB of JSON but 250-360 KB gzipped — a code graph is mostly
// repeated key names and compresses about 20:1. Small enough to commit, so CI
// runs the same assertions against the same real data.
//
// The WHOLE snapshot is stored, not a trimmed one. A hand-kept list of "fields
// the tests need" was tried first: it saved 600 KB and immediately broke eight
// assertions that reach snapshot fields through helpers rather than directly.
// A field list is a thing that silently rots every time someone adds a test;
// 946 KB is cheaper than that.
//
// A fixture FREEZES an analysis. The engine changed eight times in one session
// while this was being written, so these will drift from what the analyser
// would produce today, and the tests will keep passing while measuring
// something historical. Re-run this script when the graph changes shape.
//
// `o5QTmaYTwE` is this repo, which makes it the fastest to rot and a little
// self-referential — the tests measuring a frozen picture of the code under
// test. It is included anyway: excluding it made assertions FAIL rather than
// skip, and at 80 KB the honesty of a green suite is worth more than the
// tidiness of leaving it out.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

// Every session the five test files name. Derived, not guessed: grep the tests
// for 10-char ids and intersect with what is on disk. Add one here when a test
// starts using a new session, and re-run.
const FIXTURES = [
  ["gx1lLA07kO", "gin-gonic/gin"],
  ["yAwwHY_ShB", "pallets/flask"],
  ["DBtU3d_Gfk", "colinhacks/zod"],
  ["o5QTmaYTwE", "coffeejones/gitvision"],
  ["6xw0IjzqRh", ""],
  ["PGlVvQRlAh", "spring-petclinic"],
  ["XmCB5--NkT", ""],
  ["YnGfl-Fnwd", "dungngminh/simutil"],
  ["cO6VufGhLU", ""],
  ["xEHUPsZ73L", ""],
] as const;

function liveDir(): string {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf-8" }).trim();
  return path.join(path.dirname(path.resolve(process.cwd(), common)), ".gitvision", "sessions");
}

const out = path.join(process.cwd(), "lib", "__tests__", "fixtures", "sessions");
fs.mkdirSync(out, { recursive: true });
const dir = liveDir();

for (const [id, what] of FIXTURES) {
  const src = path.join(dir, `${id}.json`);
  if (!fs.existsSync(src)) {
    console.error(`  SKIP ${id} — not in ${dir}. Analyse ${what.split(" —")[0]} to capture it.`);
    continue;
  }
  const snap = JSON.parse(fs.readFileSync(src, "utf-8")).snapshots.at(-1);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(snap)), { level: 9 });
  fs.writeFileSync(path.join(out, `${id}.json.gz`), gz);
  console.log(`  ${id}  ${what}\n     ${Math.round(fs.statSync(src).size / 1024)} KB live -> ${Math.round(gz.length / 1024)} KB gzipped`);
}
