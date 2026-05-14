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

describe("dispatchEvent (stub)", () => {
  it("logs event metadata without throwing on valid pull_request payload", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const payload = {
      action: "opened",
      repository: { full_name: "octocat/hello-world" },
    };

    await expect(
      dispatchEvent("pull_request", payload, "delivery-abc"),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("event=pull_request"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("action=opened"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("repo=octocat/hello-world"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("delivery=delivery-abc"),
    );

    logSpy.mockRestore();
  });

  it("handles a non-object payload gracefully", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(dispatchEvent("ping", null)).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("event=ping"));
    logSpy.mockRestore();
  });

  it("handles a payload missing repository field", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      dispatchEvent("installation", { action: "created" }),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("event=installation"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("repo=—"));
    logSpy.mockRestore();
  });
});
