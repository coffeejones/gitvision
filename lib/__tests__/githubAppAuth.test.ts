import crypto from "node:crypto";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  _resetAppForTesting,
  getApp,
  getInstallationClient,
  isGitHubAppConfigured,
  loadGitHubAppConfig,
} from "../githubApp/auth";

// Generate a real 2048-bit RSA key once for the whole test file.
// We need a real key because Octokit's App constructor validates the
// PEM format and (when used) signs JWTs with it.
let testPrivateKeyPem: string;
let testPrivateKeyBase64: string;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  testPrivateKeyPem = privateKey;
  testPrivateKeyBase64 = Buffer.from(privateKey, "utf8").toString("base64");
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetAppForTesting();
});

describe("loadGitHubAppConfig", () => {
  it("returns parsed config when all required env vars are set", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "secret-abc");

    const config = loadGitHubAppConfig();

    expect(config.appId).toBe(12345);
    expect(config.privateKey).toBe(testPrivateKeyPem);
    expect(config.webhookSecret).toBe("secret-abc");
    expect(config.clientId).toBeUndefined();
  });

  it("includes clientId when set", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "secret-abc");
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.abc123");

    expect(loadGitHubAppConfig().clientId).toBe("Iv1.abc123");
  });

  it("treats empty clientId env var as undefined", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "secret-abc");
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "");

    expect(loadGitHubAppConfig().clientId).toBeUndefined();
  });

  it("throws listing every missing env var when none are set", () => {
    expect(() => loadGitHubAppConfig()).toThrow(
      /Missing env vars.*GITHUB_APP_ID.*GITHUB_APP_PRIVATE_KEY.*GITHUB_APP_WEBHOOK_SECRET/,
    );
  });

  it("throws naming the specific missing var when only one is absent", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    expect(() => loadGitHubAppConfig()).toThrow(
      /Missing env vars: GITHUB_APP_WEBHOOK_SECRET/,
    );
  });

  it("throws when APP_ID is not a number", () => {
    vi.stubEnv("GITHUB_APP_ID", "abc");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    expect(() => loadGitHubAppConfig()).toThrow(/positive integer/);
  });

  it("throws when APP_ID is zero", () => {
    vi.stubEnv("GITHUB_APP_ID", "0");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    expect(() => loadGitHubAppConfig()).toThrow(/positive integer/);
  });

  it("throws when APP_ID is negative", () => {
    vi.stubEnv("GITHUB_APP_ID", "-5");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    expect(() => loadGitHubAppConfig()).toThrow(/positive integer/);
  });

  it("throws when private key isn't a PEM after base64 decode", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      Buffer.from("not a pem at all").toString("base64"),
    );
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    expect(() => loadGitHubAppConfig()).toThrow(/PEM-encoded/);
  });

  it("throws helpfully when private key was given as raw PEM (not base64)", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    // User forgets to base64-encode and pastes the PEM directly.
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyPem);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    // The base64-decode of a real PEM produces garbage that won't match
    // the PEM regex — error message hints at base64 step.
    expect(() => loadGitHubAppConfig()).toThrow(/base64/);
  });

  it("accepts PKCS#1 RSA PRIVATE KEY format too (not just PKCS#8)", () => {
    const { privateKey: pkcs1Pem } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      Buffer.from(pkcs1Pem, "utf8").toString("base64"),
    );
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");

    const config = loadGitHubAppConfig();
    expect(config.privateKey).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });
});

describe("isGitHubAppConfigured", () => {
  it("returns false when no env vars are set", () => {
    expect(isGitHubAppConfigured()).toBe(false);
  });

  it("returns false when only APP_ID is set", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    expect(isGitHubAppConfigured()).toBe(false);
  });

  it("returns false when APP_ID + PRIVATE_KEY are set but no secret", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    expect(isGitHubAppConfigured()).toBe(false);
  });

  it("returns true when all three required vars are set", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");
    expect(isGitHubAppConfigured()).toBe(true);
  });
});

describe("getApp", () => {
  it("returns the same instance on repeated calls (singleton)", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "secret-abc");

    const a = getApp();
    const b = getApp();
    expect(a).toBe(b);
  });

  it("throws if config is missing", () => {
    expect(() => getApp()).toThrow(/Missing env vars/);
  });

  it("exposes the app-authenticated octokit + webhooks objects", () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "secret-abc");

    const app = getApp();
    expect(app.octokit).toBeDefined();
    expect(app.webhooks).toBeDefined();
    expect(typeof app.getInstallationOctokit).toBe("function");
  });
});

describe("getInstallationClient", () => {
  it("rejects non-positive installation ids", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");

    await expect(getInstallationClient(0)).rejects.toThrow(/positive integer/);
    await expect(getInstallationClient(-1)).rejects.toThrow(/positive integer/);
    await expect(getInstallationClient(NaN)).rejects.toThrow(/positive integer/);
  });

  it("delegates to App.getInstallationOctokit for valid ids", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyBase64);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "s");

    const app = getApp();
    const spy = vi
      .spyOn(app, "getInstallationOctokit")
      .mockResolvedValue({} as unknown as Awaited<
        ReturnType<typeof app.getInstallationOctokit>
      >);

    await getInstallationClient(99);
    expect(spy).toHaveBeenCalledWith(99);

    spy.mockRestore();
  });
});
