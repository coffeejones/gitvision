// Sessions are written without indentation; everything else keeps it.
//
// atomicWriteJson indented everything, and for a job or a feedback entry that
// is right — AGENTS.md calls the storage "inspectable" on purpose and those
// files are small enough to read with `cat`. A session is not: the stored
// colinhacks/zod analysis was 55.3 MB on disk holding 33.8 MB of JSON, so 39%
// of the file was whitespace. Reading and parsing it cost 118ms, 55ms compact —
// the read alone 57ms → 9ms — which measured out as 14-24% off every session
// page.
//
// Two things have to stay true: sessions must be written compact, and the
// migration pass that rewrites already-indented files must stay idempotent and
// type-free (it runs in a plain .mjs before `next start`, so it cannot import
// anything from lib/).

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { atomicWriteJson } from "../atomicWrite";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

describe("atomicWriteJson", () => {
  it("indents by default", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ct-write-"));
    const f = path.join(dir, "a.json");
    await atomicWriteJson(f, { a: 1, b: { c: 2 } });
    expect(readFileSync(f, "utf-8")).toContain("\n  ");
  });

  it("omits the indent when asked, without changing the data", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ct-write-"));
    const value = { a: 1, b: { c: [1, 2, 3] }, d: null };
    const pretty = path.join(dir, "p.json");
    const compact = path.join(dir, "c.json");
    await atomicWriteJson(pretty, value);
    await atomicWriteJson(compact, value, { compact: true });

    expect(readFileSync(compact, "utf-8")).not.toContain("\n");
    expect(statSync(compact).size).toBeLessThan(statSync(pretty).size);
    // The only difference is formatting.
    expect(JSON.parse(readFileSync(compact, "utf-8"))).toEqual(
      JSON.parse(readFileSync(pretty, "utf-8")),
    );
  });
});

describe("session writes take the compact path", () => {
  const storage = read("lib", "storage.ts");

  it("every sessionPath write passes compact", () => {
    const writes = [...storage.matchAll(
      /atomicWriteJson\([\s\S]*?sessionPath\([^)]*\)[\s\S]*?\);/g,
    )];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w[0], "a session write without { compact: true }").toContain("compact: true");
    }
  });

  it("leaves the small stores indented", () => {
    // Jobs and feedback are a few hundred bytes each; the inspectability is
    // worth more there than the whitespace costs.
    for (const f of ["jobs.ts", "feedback.ts"]) {
      expect(read("lib", f)).not.toContain("compact: true");
    }
  });
});

describe("every write path leaves the file compact", () => {
  // Greping storage.ts proves the call sites pass the flag; this proves the
  // BEHAVIOUR, which is what actually matters. A single writer left on the
  // indented default would silently re-inflate a session the first time anyone
  // renamed it or the AI wrote a narrative back — undoing the migration one
  // file at a time, invisibly.
  it("survives create, rename and patch", async () => {
    const { createSession, renameSession, patchLatestSnapshot, deleteSession } =
      await import("../storage");
    const dir = path.join(process.cwd(), ".gitvision", "sessions");
    const headOf = (id: string) =>
      readFileSync(path.join(dir, `${id}.json`), "utf-8").slice(0, 2);

    const session = await createSession({
      repoUrl: "https://github.com/compaction/probe",
      name: "compaction/probe",
      initialSnapshot: {
        fetchedAt: new Date(0).toISOString(),
        repo: {
          owner: "compaction", name: "probe", fullName: "compaction/probe",
          description: null, stars: 0, forks: 0, watchers: 0, openIssues: 0,
          defaultBranch: "main", createdAt: "2020-01-01T00:00:00Z",
          updatedAt: "2020-01-01T00:00:00Z", pushedAt: "2020-01-01T00:00:00Z",
          language: null, license: null, homepage: null, topics: [], private: false,
        },
        contributors: [], languages: {}, recentCommits: [],
        hotspots: [], coChange: [], commitActivity: [],
      },
    });

    try {
      expect(headOf(session.id), "createSession").toBe('{"');
      await renameSession(session.id, "renamed");
      expect(headOf(session.id), "renameSession").toBe('{"');
      await patchLatestSnapshot(session.id, { hasReadme: true });
      expect(headOf(session.id), "patchLatestSnapshot").toBe('{"');
    } finally {
      await deleteSession(session.id);
    }
  });
});

describe("the migration pass that rewrites old files", () => {
  const migrate = readFileSync(
    path.join(process.cwd(), "scripts", "migrate.mjs"),
    "utf-8",
  );

  it("imports nothing from lib/", () => {
    // It runs as plain .mjs before `next start`; a TS import would break the
    // container boot, and Railway installs with --omit=dev so tsx is absent.
    expect(migrate).not.toMatch(/from\s+["']\.\.\/lib\//);
    expect(migrate).not.toMatch(/require\(["']\.\.\/lib\//);
  });

  it("skips files that are already compact", () => {
    // Without the check it would rewrite every session on every container
    // start, which on a big volume is minutes of pointless I/O.
    expect(migrate).toMatch(/head\.toString\("utf-8"\) !== "\{\\n"/);
  });

  it("writes through a temp file and renames", () => {
    // Same reason lib/atomicWrite.ts does: a kill mid-pass must not leave a
    // half-written session.
    expect(migrate).toMatch(/renameSync/);
    expect(migrate).toMatch(/\.tmp/);
  });

  it("does not let one bad session stop the boot", () => {
    expect(migrate).toMatch(/could not compact/);
  });
});

describe("the sessions on disk are actually compact", () => {
  it("none of them start with an indent", () => {
    // Belt and braces: proves the pass ran here, and would catch a regression
    // where something wrote a session through the default path again.
    const dir = path.join(process.cwd(), ".gitvision", "sessions");
    let checked = 0;
    const indented: string[] = [];
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        checked++;
        const head = readFileSync(path.join(dir, name), "utf-8").slice(0, 2);
        if (head === "{\n") indented.push(name);
      }
    } catch {
      return; // no local sessions (CI) — nothing to assert
    }
    if (checked === 0) return;
    expect(indented, "session written with the indented default").toEqual([]);
  });
});
