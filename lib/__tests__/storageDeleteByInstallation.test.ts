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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repobaron-storage-"));
  vi.stubEnv("REPOBARON_DATA_DIR", tmpDir);
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
      name: "user-created",
      initialSnapshot: minimalSnapshot(),
      ownerId: "anon-uuid",
    });
    const summaries = await listSessions();
    expect(summaries.length).toBe(1);
    expect("installationId" in summaries[0]!).toBe(false);
  });
});

describe("listSessions — bot-session visibility filter", () => {
  it("excludes PR-bot sessions (installationId set) from listings", async () => {
    // The exact bug Jonas reported: bot sessions had no ownerId, so
    // filterSessionsByOwner treated them as legacy-visible-to-all,
    // routing every new visitor into WorkspaceHome and showing the
    // bot's analysis sessions in "Your sessions". listSessions must
    // never surface them in the first place.
    await createSession({
      repoUrl: "https://github.com/coffeejones/repobaronTest",
      name: "coffeejones/repobaronTest @ f5b003b5 (PR #1)",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
    });
    await createSession({
      repoUrl: "https://github.com/coffeejones/repobaronTest",
      name: "coffeejones/repobaronTest @ a1b2c3d4 (base of PR #1)",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
    });

    const summaries = await listSessions();
    expect(summaries).toHaveLength(0);
  });

  it("still includes workspace-created sessions (installationId undefined)", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "workspace-session",
      initialSnapshot: minimalSnapshot(),
      ownerId: "anon-uuid",
    });

    const summaries = await listSessions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("workspace-session");
  });

  it("mixes correctly — only workspace sessions returned when both exist", async () => {
    await createSession({
      repoUrl: "https://github.com/alice/repo",
      name: "user-1",
      initialSnapshot: minimalSnapshot(),
      ownerId: "anon-uuid",
    });
    await createSession({
      repoUrl: "https://github.com/coffeejones/repobaronTest",
      name: "bot-1",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
    });
    await createSession({
      repoUrl: "https://github.com/alice/repo-2",
      name: "user-2",
      initialSnapshot: minimalSnapshot(),
      ownerId: "anon-uuid",
    });
    await createSession({
      repoUrl: "https://github.com/coffeejones/repobaronTest",
      name: "bot-2",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
    });

    const summaries = await listSessions();
    const names = summaries.map((s) => s.name).sort();
    expect(names).toEqual(["user-1", "user-2"]);
  });

  it("excludes legacy bot sessions even without ownerId on user sessions", async () => {
    // Pre-v0.26 "legacy" workspace sessions (no ownerId) must stay
    // visible — that's why the original ownership filter has the
    // !ownerId backward-compat clause. But bot sessions with
    // installationId set are NOT legacy — they should be filtered
    // out regardless of ownerId state.
    await createSession({
      repoUrl: "https://github.com/legacy/repo",
      name: "true-legacy",
      initialSnapshot: minimalSnapshot(),
      // no ownerId, no installationId — pre-v0.26 workspace session
    });
    await createSession({
      repoUrl: "https://github.com/coffeejones/repobaronTest",
      name: "bot-no-owner",
      initialSnapshot: minimalSnapshot(),
      installationId: 99,
      // no ownerId — like every bot session
    });

    const summaries = await listSessions();
    expect(summaries.map((s) => s.name)).toEqual(["true-legacy"]);
  });
});
