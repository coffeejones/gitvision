// Regression tests for lib/atomicWrite.ts. The atomicWriteJson helper is
// the shared replacement for the three inline copies previously in
// lib/jobs.ts, lib/feedback.ts (both had the temp+rename pattern) and
// lib/storage.ts (plain fs.writeFile — the audit-flagged bug we fixed).
//
// What we verify:
//   - Successful write produces a valid JSON file at the target path
//   - Target file is replaced cleanly (rename, not append) on overwrite
//   - The temp file does not leak on a successful write
//   - JSON.stringify produces a human-readable 2-space-indented file
//     (we rely on this format when inspecting on-disk state during debug)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWriteJson } from "../atomicWrite";

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "atomicWriteJson-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("writes a JSON file at the target path", async () => {
    const target = path.join(dir, "data.json");
    await atomicWriteJson(target, { hello: "world" });
    const content = await fs.readFile(target, "utf-8");
    expect(JSON.parse(content)).toEqual({ hello: "world" });
  });

  it("overwrites an existing file (rename replaces, no append)", async () => {
    const target = path.join(dir, "data.json");
    await fs.writeFile(target, JSON.stringify({ stale: true }), "utf-8");
    await atomicWriteJson(target, { fresh: true });
    const content = await fs.readFile(target, "utf-8");
    expect(JSON.parse(content)).toEqual({ fresh: true });
  });

  it("does not leak temp files on success", async () => {
    const target = path.join(dir, "data.json");
    await atomicWriteJson(target, { ok: true });
    const entries = await fs.readdir(dir);
    // Only the target file should remain — no .tmp.* siblings
    expect(entries).toEqual(["data.json"]);
  });

  it("writes 2-space-indented JSON (human-readable on disk)", async () => {
    const target = path.join(dir, "data.json");
    await atomicWriteJson(target, { a: 1, b: { c: 2 } });
    const content = await fs.readFile(target, "utf-8");
    expect(content).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });

  it("supports concurrent writes to the same target without corruption", async () => {
    // Race two writes — both should succeed and the final file should be
    // a valid JSON document (one of the two payloads, never a mix).
    const target = path.join(dir, "data.json");
    await Promise.all([
      atomicWriteJson(target, { winner: "A" }),
      atomicWriteJson(target, { winner: "B" }),
    ]);
    const content = await fs.readFile(target, "utf-8");
    const parsed = JSON.parse(content); // Must parse — no half-write
    expect(["A", "B"]).toContain(parsed.winner);
    // And no temp files left behind
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(["data.json"]);
  });
});
