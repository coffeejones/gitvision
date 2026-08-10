// Tests may not take their fixtures out of `.gitvision/sessions`.
//
// That directory is gitignored. A test that reads it passes on the machine that
// captured the analysis and throws ENOENT everywhere else — which is the most
// expensive kind of green, because it looks like coverage right up until CI
// runs. The sessions were committed as gzipped fixtures precisely to end this
// (99ec3ac), and one commit later `workspaceGoals.test.ts` reintroduced the
// direct read and took main red for a day (run 31256876872, ENOENT on
// PGlVvQRlAh.json).
//
// So: go through `loadSnapshot()` in helpers/sessionFixture, which prefers the
// committed fixture and falls back to a live session. This file fails the
// moment someone reaches around it.
//
// The one legitimate exception is a test whose SUBJECT is the files on disk
// rather than their contents. It is named below, and the allowance is not taken
// on trust — the assertions check that it still tolerates the directory being
// absent, so the exemption cannot quietly become the bug it excludes.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), "lib", "__tests__");

/** Reading `.gitvision` is allowed here because the test writes what it reads
 *  (createSession) or returns when the directory is missing. Both are asserted
 *  below — an entry that stops being true fails this file. */
const ALLOWED = new Set(["sessionCompaction.test.ts"]);

/** The helper that owns the lookup. Not a test. */
const OWNER = path.join("helpers", "sessionFixture.ts");

function testFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...testFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts")) {
      out.push(rel);
    }
  }
  return out;
}

/** A path join into the SESSION directory — the thing that breaks on CI.
 *
 *  Deliberately narrower than "mentions .gitvision". A comment saying "measured
 *  on the sessions in .gitvision/sessions" is documentation, and
 *  pluginRegistry.test.ts lists ".gitvision" as a directory to skip while
 *  walking the tree. Neither reads anything. What breaks CI is a path built
 *  into the directory, in one of its two written forms. */
const READS_SESSIONS =
  /\.gitvision["'`]\s*,\s*["'`]sessions|["'`][^"'`\n]*\.gitvision\/sessions/;

/** This file carries a verbatim copy of the broken line as a specimen, so the
 *  matcher necessarily fires on it. Exempting it costs nothing: the specimen is
 *  run through the matcher explicitly below, which is a stronger check than
 *  being swept up by the corpus scan. */
const SELF = "fixtureDiscipline.test.ts";

describe("no test reads its fixtures out of the gitignored session directory", () => {
  it("every test file goes through the fixture loader", () => {
    const offenders: string[] = [];
    for (const file of testFiles(TEST_DIR)) {
      if (file === OWNER || file === SELF) continue;
      if (ALLOWED.has(path.basename(file)) && !file.includes(path.sep)) continue;
      const src = readFileSync(path.join(TEST_DIR, file), "utf-8");
      if (READS_SESSIONS.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      "reads .gitvision directly — import loadSnapshot from ./helpers/sessionFixture instead, " +
        "or CI goes red with ENOENT the way run 31256876872 did",
    ).toEqual([]);
  });

  it("scans a real, non-empty set of test files", () => {
    // A regex guard whose corpus quietly became empty passes forever. This is
    // the failure mode of every source-reading test, so it gets its own check.
    const files = testFiles(TEST_DIR);
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("workspaceGoals.test.ts");
  });

  it("would have caught the regression that took main red", () => {
    // Run the real matcher over the real prior source, rather than asserting a
    // string literal against itself. The line below is verbatim from
    // workspaceGoals.test.ts at 6363d81.
    const asItWas = `const session = (id: string): AnalysisSnapshot =>
  JSON.parse(
    readFileSync(
      path.join(process.cwd(), ".gitvision", "sessions", \`\${id}.json\`),
      "utf-8",
    ),
  ).snapshots.at(-1);`;
    expect(READS_SESSIONS.test(asItWas)).toBe(true);

    // And it must not fire on the fixed version, or the guard is unusable.
    const asItIs = readFileSync(
      path.join(TEST_DIR, "workspaceGoals.test.ts"),
      "utf-8",
    );
    expect(READS_SESSIONS.test(asItIs)).toBe(false);
    expect(asItIs).toContain("loadSnapshot");
  });
});

describe("the one exemption still earns itself", () => {
  it("writes what it reads, and returns when the directory is absent", () => {
    // sessionCompaction is ABOUT the bytes of the files on disk, so it has to
    // touch the real directory. What makes that safe is that it creates its own
    // session first, and bails out rather than throwing when there is nothing
    // local to inspect. If either goes away it is no longer an exception.
    const src = readFileSync(
      path.join(TEST_DIR, "sessionCompaction.test.ts"),
      "utf-8",
    );
    expect(src, "no longer writes the session it reads").toContain("createSession");
    expect(src, "no longer tolerates a missing directory").toMatch(
      /catch \{\s*\n?\s*return;/,
    );
    expect(src).toMatch(/if \(checked === 0\) return;/);
  });

  it("names every exemption, so the list cannot grow silently", () => {
    expect(ALLOWED.size, "a new exemption needs a reason written next to it").toBe(1);
  });
});

describe("the fixtures are documented as they actually are", () => {
  // The helper's header spent four months arguing that committing these was
  // infeasible — 61 MB raw, 10 MB trimmed — while ten of them sat in the
  // directory next to it. Both numbers were measured uncompressed, which was the
  // whole error, and the same false rationale had been copied verbatim into four
  // test files. A comment that argues against work already done sends the next
  // reader to redo the analysis that produced it.
  const FIXTURE_DIR = path.join(TEST_DIR, "fixtures", "sessions");

  const DISPROVEN = [
    "far too much to commit",
    "~300 KB for all three",
    "Committed, trimmed",
  ];

  it("does not repeat a rationale the repository disproved", () => {
    const offenders: string[] = [];
    for (const file of testFiles(TEST_DIR)) {
      const src = readFileSync(path.join(TEST_DIR, file), "utf-8");
      for (const claim of DISPROVEN) {
        if (src.includes(claim) && file !== SELF) offenders.push(`${file}: "${claim}"`);
      }
    }
    expect(offenders, "a disproven claim about the fixtures is back").toEqual([]);
  });

  it("has fixtures to be wrong about", () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json.gz"));
    expect(files.length, "no fixtures — the guard above would pass vacuously")
      .toBeGreaterThan(3);
  });

  it("stores whole snapshots, and the helper says so", () => {
    // The generator and the helper have to agree, or the next person trims.
    const generator = readFileSync(
      path.join(process.cwd(), "bench", "makeSessionFixtures.ts"),
      "utf-8",
    );
    expect(generator).toContain("The WHOLE snapshot is stored, not a trimmed one");
    const helper = readFileSync(path.join(TEST_DIR, OWNER), "utf-8");
    expect(helper).toMatch(/WHOLE, gzipped snapshots/);
    expect(helper, "the helper claims a trim the generator does not do").not.toMatch(
      /Committed, trimmed/,
    );
  });
});
