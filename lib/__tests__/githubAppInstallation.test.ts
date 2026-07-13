import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleInstallationEvent,
  type InstallationHandlerDeps,
} from "../githubApp/events/installation";

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

function makeDeps(
  override: Partial<InstallationHandlerDeps> = {},
): InstallationHandlerDeps {
  return {
    deleteSessionsByInstallation:
      override.deleteSessionsByInstallation ??
      (vi.fn(
        async () => 0,
      ) as unknown as InstallationHandlerDeps["deleteSessionsByInstallation"]),
    deleteReceiptsByInstallation:
      override.deleteReceiptsByInstallation ??
      (vi.fn(
        async () => 0,
      ) as unknown as InstallationHandlerDeps["deleteReceiptsByInstallation"]),
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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

describe("handleInstallationEvent — session GC on deleted", () => {
  it("invokes deleteSessionsByInstallation with the right id on deleted", async () => {
    const deps = makeDeps();
    await handleInstallationEvent(
      makePayload({ action: "deleted", id: 12345 }),
      "d",
      deps,
    );

    expect(deps.deleteSessionsByInstallation).toHaveBeenCalledTimes(1);
    expect(deps.deleteSessionsByInstallation).toHaveBeenCalledWith(12345);
  });

  it("does NOT invoke deleteSessionsByInstallation on created", async () => {
    const deps = makeDeps();
    await handleInstallationEvent(
      makePayload({ action: "created" }),
      "d",
      deps,
    );

    expect(deps.deleteSessionsByInstallation).not.toHaveBeenCalled();
  });

  it.each(["suspend", "unsuspend", "new_permissions_accepted"])(
    "does NOT invoke deleteSessionsByInstallation on action=%s",
    async (action) => {
      const deps = makeDeps();
      await handleInstallationEvent(makePayload({ action }), "d", deps);
      expect(deps.deleteSessionsByInstallation).not.toHaveBeenCalled();
    },
  );

  it("logs the count returned by deleteSessionsByInstallation", async () => {
    const logSpy = vi.spyOn(console, "log");
    const deps = makeDeps({
      deleteSessionsByInstallation: vi.fn(
        async () => 7,
      ) as unknown as InstallationHandlerDeps["deleteSessionsByInstallation"],
    });
    await handleInstallationEvent(
      makePayload({ action: "deleted", id: 42 }),
      "d",
      deps,
    );

    const logs = logSpy.mock.calls.flat().join(" ");
    expect(logs).toContain("deleted_sessions=7");
  });

  it("still returns accepted when deleteSessionsByInstallation throws", async () => {
    // The GC helper is supposed to never throw; this asserts our
    // defense-in-depth behavior if something slips through.
    const deps = makeDeps({
      deleteSessionsByInstallation: vi.fn(async () => {
        throw new Error("disk error");
      }) as unknown as InstallationHandlerDeps["deleteSessionsByInstallation"],
    });
    const result = await handleInstallationEvent(
      makePayload({ action: "deleted", id: 7 }),
      "d",
      deps,
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.reason).toBe("deleted");
    }
  });
});
