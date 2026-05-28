// Tests for the v0.74 feedback module:
//   - validateFeedback rejects empty / oversized / malformed inputs
//   - submitFeedback writes to disk in the configured data dir
//   - clampContext truncates oversized auto-included context fields
//
// We DON'T exercise the webhook forwarding path — that would mean
// hitting an external URL or mocking fetch. The webhook is fire-and-
// forget and best-effort; disk write is the source of truth.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Same env-var-before-import dance as jobs.test.ts so the lazy
// feedbackDir() helper picks up our temp dir.
const TMP_ROOT = path.join(
  os.tmpdir(),
  `repobaron-feedback-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);
process.env.REPOBARON_DATA_DIR = TMP_ROOT;
// Make sure no webhook gets called during tests even if the dev shell
// has REPOBARON_FEEDBACK_WEBHOOK_URL set.
delete process.env.REPOBARON_FEEDBACK_WEBHOOK_URL;

import { submitFeedback } from "../feedback";
import {
  validateFeedback,
  FEEDBACK_LIMITS,
  type FeedbackInput,
} from "../feedbackTypes";

beforeEach(async () => {
  await fs.rm(path.join(TMP_ROOT, "feedback"), {
    recursive: true,
    force: true,
  });
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe("validateFeedback", () => {
  it("accepts a minimal valid input", () => {
    const errors = validateFeedback({
      type: "bug",
      description: "the button doesn't work",
    });
    expect(errors).toBeNull();
  });

  it("rejects missing or unknown type", () => {
    expect(validateFeedback({ description: "x" })?.[0]?.field).toBe("type");
    expect(
      validateFeedback({
        // @ts-expect-error — testing runtime guard
        type: "complaint",
        description: "x",
      })?.[0]?.field
    ).toBe("type");
  });

  it("rejects empty description (after trim)", () => {
    const errors = validateFeedback({ type: "bug", description: "   " });
    expect(errors).not.toBeNull();
    expect(errors?.[0]?.field).toBe("description");
  });

  it("rejects description longer than the cap", () => {
    const errors = validateFeedback({
      type: "general",
      description: "a".repeat(FEEDBACK_LIMITS.description + 1),
    });
    expect(errors?.[0]?.field).toBe("description");
  });

  it("accepts a valid email", () => {
    const errors = validateFeedback({
      type: "bug",
      description: "ok",
      email: "user@example.com",
    });
    expect(errors).toBeNull();
  });

  it("accepts an undefined or empty-string email (optional field)", () => {
    expect(
      validateFeedback({ type: "bug", description: "ok" })
    ).toBeNull();
    expect(
      validateFeedback({ type: "bug", description: "ok", email: "" })
    ).toBeNull();
  });

  it("rejects malformed email (no @ or no domain dot)", () => {
    expect(
      validateFeedback({
        type: "bug",
        description: "ok",
        email: "not-an-email",
      })?.[0]?.field
    ).toBe("email");
    expect(
      validateFeedback({
        type: "bug",
        description: "ok",
        email: "user@nodomain",
      })?.[0]?.field
    ).toBe("email");
  });

  it("rejects an email longer than the cap", () => {
    const errors = validateFeedback({
      type: "bug",
      description: "ok",
      email: "a".repeat(FEEDBACK_LIMITS.email + 1) + "@x.io",
    });
    expect(errors?.[0]?.field).toBe("email");
  });
});

describe("submitFeedback", () => {
  async function readEntry(id: string) {
    const filePath = path.join(TMP_ROOT, "feedback", `${id}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  it("persists a JSON file under the configured data dir", async () => {
    const result = await submitFeedback({
      type: "bug",
      description: "menu doesn't close on Esc",
    });
    expect(result.id).toBeTruthy();
    expect(result.webhookForwarded).toBe(false);
    const entry = await readEntry(result.id);
    expect(entry.id).toBe(result.id);
    expect(entry.type).toBe("bug");
    expect(entry.description).toBe("menu doesn't close on Esc");
    expect(entry.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes optional context (email, page url, session id)", async () => {
    const result = await submitFeedback({
      type: "feature",
      description: "would love a keyboard shortcut for refresh",
      email: "test@example.com",
      pageUrl: "https://repojury.com/session/abc123",
      sessionId: "abc123",
    });
    const entry = await readEntry(result.id);
    expect(entry.email).toBe("test@example.com");
    expect(entry.pageUrl).toBe("https://repojury.com/session/abc123");
    expect(entry.sessionId).toBe("abc123");
  });

  it("clamps oversized context fields to their limits", async () => {
    const longUrl = "https://x.com/" + "a".repeat(2000);
    const longUserAgent = "Mozilla/5.0 " + "x".repeat(2000);
    const result = await submitFeedback({
      type: "general",
      description: "ok",
      pageUrl: longUrl,
      userAgent: longUserAgent,
    });
    const entry = await readEntry(result.id);
    // Defensive clamps — exact length comes from feedback.ts but
    // shorter than what we sent in is the invariant we care about.
    expect(entry.pageUrl.length).toBeLessThanOrEqual(500);
    expect(entry.userAgent.length).toBeLessThanOrEqual(500);
  });

  it("trims whitespace from description and stores ip context", async () => {
    const result = await submitFeedback(
      { type: "bug", description: "  trailing spaces around   " } as FeedbackInput,
      { ip: "1.2.3.4" }
    );
    const entry = await readEntry(result.id);
    expect(entry.description).toBe("trailing spaces around");
    expect(entry.ip).toBe("1.2.3.4");
  });

  it("each submission gets a unique id", async () => {
    const a = await submitFeedback({ type: "bug", description: "one" });
    const b = await submitFeedback({ type: "bug", description: "two" });
    expect(a.id).not.toBe(b.id);
  });
});
