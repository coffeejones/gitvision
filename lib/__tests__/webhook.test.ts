import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  dispatchEvent,
  verifyWebhookSignature,
} from "../githubApp/webhook";

function sign(body: string, secret: string): string {
  const hex = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");
  return `sha256=${hex}`;
}

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret-1234567890";
  const body = JSON.stringify({ action: "opened", number: 42 });

  it("returns true for a valid signature", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("returns false for a tampered body", () => {
    const sig = sign(body, secret);
    expect(verifyWebhookSignature(body + "x", sig, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = sign(body, "different-secret");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(false);
  });

  it("returns false when signature header is null", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it("returns false when signature header is undefined", () => {
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it("returns false when secret is empty", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), "")).toBe(false);
  });

  it("returns false when signature lacks sha256= prefix", () => {
    const hex = crypto
      .createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
    expect(verifyWebhookSignature(body, hex, secret)).toBe(false);
  });

  it("returns false when signature uses an unsupported algo prefix", () => {
    const hex = crypto
      .createHmac("sha1", secret)
      .update(body, "utf8")
      .digest("hex");
    // GitHub's legacy sha1 header is explicitly NOT accepted — we are
    // sha256-only.
    expect(verifyWebhookSignature(body, `sha1=${hex}`, secret)).toBe(false);
  });

  it("returns false for non-hex digest content", () => {
    expect(verifyWebhookSignature(body, "sha256=not-hex-zz", secret)).toBe(
      false,
    );
  });

  it("returns false for a digest of the wrong length", () => {
    // Too short — 32 chars instead of 64.
    expect(verifyWebhookSignature(body, `sha256=${"a".repeat(32)}`, secret)).toBe(
      false,
    );
  });

  it("returns false for a same-length but wrong digest (constant-time path)", () => {
    expect(verifyWebhookSignature(body, `sha256=${"a".repeat(64)}`, secret)).toBe(
      false,
    );
  });

  it("verifies an empty body correctly", () => {
    expect(verifyWebhookSignature("", sign("", secret), secret)).toBe(true);
  });

  it("verifies a unicode body correctly", () => {
    const unicodeBody = JSON.stringify({ author: "Jønas", repo: "café/π" });
    expect(
      verifyWebhookSignature(unicodeBody, sign(unicodeBody, secret), secret),
    ).toBe(true);
  });
});

describe("dispatchEvent routing", () => {
  it("returns accepted on ping events", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await dispatchEvent("ping", { zen: "hi" }, "delivery-1");
    expect(result).toEqual({ status: "accepted", reason: "ping" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ping"));
    logSpy.mockRestore();
  });

  it("returns skipped for unsupported event types", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await dispatchEvent("star", {}, "delivery-2");
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("star");
    logSpy.mockRestore();
  });

  it("routes pull_request events to the pull-request handler", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await dispatchEvent(
      "pull_request",
      {
        action: "opened",
        pull_request: {
          number: 1,
          user: { login: "alice" },
          base: { sha: "a".repeat(40), ref: "main" },
          head: { sha: "b".repeat(40), ref: "feature" },
        },
        repository: {
          full_name: "alice/repo",
          private: false,
          clone_url: "https://github.com/alice/repo.git",
        },
      },
      "delivery-3",
    );
    expect(result.status).toBe("accepted");
    logSpy.mockRestore();
  });

  it("routes installation events to the installation handler", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await dispatchEvent(
      "installation",
      {
        action: "created",
        installation: { id: 99, account: { login: "alice" } },
        repositories: [{ full_name: "alice/repo", private: false }],
      },
      "delivery-4",
    );
    expect(result.status).toBe("accepted");
    logSpy.mockRestore();
  });

  it("returns error when pull_request payload fails validation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await dispatchEvent("pull_request", { not: "valid" }, "d");
    expect(result.status).toBe("error");
    warnSpy.mockRestore();
  });
});
