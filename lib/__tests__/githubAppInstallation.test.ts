import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleInstallationEvent } from "../githubApp/events/installation";

interface InstallationOverrides {
  action?: string;
  id?: number;
  accountLogin?: string;
  repositories?: { full_name: string; private: boolean }[];
}

function makePayload(overrides: InstallationOverrides = {}): unknown {
  return {
    action: overrides.action ?? "created",
    installation: {
      id: overrides.id ?? 12345,
      account: {
        login: overrides.accountLogin ?? "alice",
        type: "User",
      },
    },
    repositories: overrides.repositories ?? [
      { full_name: "alice/repo-1", private: false },
      { full_name: "alice/repo-2", private: false },
    ],
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleInstallationEvent — supported actions", () => {
  it("accepts created", async () => {
    const result = await handleInstallationEvent(makePayload(), "d");
    expect(result).toEqual({ status: "accepted", reason: "created" });
  });

  it("accepts deleted", async () => {
    const result = await handleInstallationEvent(
      makePayload({ action: "deleted" }),
      "d",
    );
    expect(result).toEqual({ status: "accepted", reason: "deleted" });
  });
});

describe("handleInstallationEvent — unsupported actions", () => {
  it.each(["suspend", "unsuspend", "new_permissions_accepted"])(
    "skips action=%s",
    async (action) => {
      const result = await handleInstallationEvent(
        makePayload({ action }),
        "d",
      );
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toContain(action);
      }
    },
  );
});

describe("handleInstallationEvent — payload shape", () => {
  it("accepts installation event without repositories array (e.g. suspend)", async () => {
    const payload = makePayload({ action: "deleted" });
    const obj = payload as Record<string, unknown>;
    delete obj.repositories;

    const result = await handleInstallationEvent(payload, "d");
    expect(result.status).toBe("accepted");
  });

  it("accepts installation event without account info", async () => {
    const payload = makePayload();
    const obj = payload as Record<string, unknown>;
    const inst = obj.installation as Record<string, unknown>;
    delete inst.account;

    const result = await handleInstallationEvent(payload, "d");
    expect(result.status).toBe("accepted");
  });

  it("returns error when installation.id is missing", async () => {
    const payload = makePayload();
    const obj = payload as Record<string, unknown>;
    const inst = obj.installation as Record<string, unknown>;
    delete inst.id;

    const result = await handleInstallationEvent(payload, "d");
    expect(result.status).toBe("error");
  });

  it("returns error on null payload", async () => {
    const result = await handleInstallationEvent(null, "d");
    expect(result.status).toBe("error");
  });

  it("returns error on malformed payload", async () => {
    const result = await handleInstallationEvent({ action: "created" }, "d");
    expect(result.status).toBe("error");
  });
});

describe("handleInstallationEvent — logging", () => {
  it("logs repo count + account login on accepted events", async () => {
    const logSpy = vi.spyOn(console, "log");
    await handleInstallationEvent(
      makePayload({
        accountLogin: "bob",
        repositories: [
          { full_name: "bob/r1", private: false },
          { full_name: "bob/r2", private: false },
          { full_name: "bob/r3", private: false },
        ],
      }),
      "d-1",
    );

    const logs = logSpy.mock.calls.flat().join(" ");
    expect(logs).toContain("account=bob");
    expect(logs).toContain("repos=3");
  });
});
