import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  deleteSessionsByInstallation,
  getSession,
  listSessions,
} from "../storage";
import type { AnalysisSnapshot } from "../types";

let tmpDir: string;

function minimalSnapshot(): AnalysisSnapshot {
  // Storage doesn't validate snapshot shape — it just round-trips JSON.
  // A cast keeps the test fixture trivial without dragging in the full
  // AnalysisSnapshot constructor.
  return {
    fetchedAt: new Date().toISOString(),
    repo: { fullName: "alice/repo" },
  } as unknown as AnalysisSnapshot;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitvision-storage-"));
  vi.stubEnv("GITVISION_DATA_DIR", tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("deleteSessionsByInstallation", () => {
  it("returns 0 when no sessions exist", async () => {
    const count = await deleteSessionsByInstallation(42);
    expect(count).toBe(0);
  });

  it("deletes sessions tagged with the given installation id", async () => {
    const a = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "tagged-1",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });
    const b = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "tagged-2",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });

    const count = await deleteSessionsByInstallation(7);

    expect(count).toBe(2);
    expect(await getSession(a.id)).toBeNull();
    expect(await getSession(b.id)).toBeNull();
  });

  it("leaves sessions from other installations alone", async () => {
    const keep = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "other-install",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
    });
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "target",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });

    const count = await deleteSessionsByInstallation(7);

    expect(count).toBe(1);
    expect(await getSession(keep.id)).not.toBeNull();
  });

  it("leaves workspace-created sessions (installationId undefined) alone", async () => {
    const workspace = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "workspace",
      initialSnapshot: minimalSnapshot(),
      ownerId: "anon-uuid",
      // installationId intentionally omitted
    });
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "bot",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });

    const count = await deleteSessionsByInstallation(7);

    expect(count).toBe(1);
    const survivor = await getSession(workspace.id);
    expect(survivor).not.toBeNull();
    expect(survivor?.installationId).toBeUndefined();
  });

  it("is idempotent — second call returns 0", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "x",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });

    expect(await deleteSessionsByInstallation(7)).toBe(1);
    expect(await deleteSessionsByInstallation(7)).toBe(0);
  });

  it("survives a corrupted session file in the directory", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "valid",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });
    // Plant a corrupted file in the sessions dir
    await fs.writeFile(
      path.join(tmpDir, "sessions", "corrupted.json"),
      "{ this is not JSON",
      "utf-8",
    );

    const count = await deleteSessionsByInstallation(7);

    expect(count).toBe(1);
    // Corrupted file should still be there — we skip, don't crash
    const files = await fs.readdir(path.join(tmpDir, "sessions"));
    expect(files).toContain("corrupted.json");
  });

  it("ignores non-json files in the sessions dir", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "valid",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });
    await fs.writeFile(
      path.join(tmpDir, "sessions", "README.txt"),
      "not a session",
      "utf-8",
    );

    const count = await deleteSessionsByInstallation(7);
    expect(count).toBe(1);
  });
});

describe("createSession — installationId persistence", () => {
  it("round-trips installationId through createSession + getSession", async () => {
    const s = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "x",
      initialSnapshot: minimalSnapshot(),
      installationId: 12345,
    });

    const loaded = await getSession(s.id);
    expect(loaded?.installationId).toBe(12345);
  });

  it("leaves installationId undefined when not provided", async () => {
    const s = await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "x",
      initialSnapshot: minimalSnapshot(),
    });

    const loaded = await getSession(s.id);
    expect(loaded?.installationId).toBeUndefined();
  });

  it("does not surface installationId in SessionSummary list (yet)", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "x",
      initialSnapshot: minimalSnapshot(),
      installationId: 7,
    });
    const summaries = await listSessions();
    // Sanity check — installationId isn't part of SessionSummary, so
    // the field shouldn't be present on the listing row even if the
    // underlying Session has it.
    expect(summaries.length).toBeGreaterThan(0);
    expect("installationId" in summaries[0]!).toBe(false);
  });
});
