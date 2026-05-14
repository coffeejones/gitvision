// Regression tests for lib/ownership.ts. The shared helper guards three
// mutating endpoint families (session DELETE/PATCH, AI summary, AI health).
// Two of those — summary and health — were the audit-flagged holes: they
// had no ownership check at all, leaving the Anthropic budget exposed to
// anyone who knew a session id. This file pins the contract so a future
// extraction or rename can't quietly drop the check from any caller.

import { describe, it, expect } from "vitest";
import { requireSessionOwnership } from "../ownership";
import type { Session, AnalysisSnapshot } from "../types";

function makeSession(ownerId?: string): Session {
  return {
    id: "abc123",
    name: "test",
    repoUrl: "https://github.com/foo/bar",
    ownerId,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    snapshots: [] as unknown as AnalysisSnapshot[],
  };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://x/api/sessions/abc123", { headers });
}

describe("requireSessionOwnership", () => {
  it("returns null (allow) when caller header matches stored ownerId", () => {
    const session = makeSession("owner-uuid-123");
    const req = makeRequest({ "X-Owner-Id": "owner-uuid-123" });
    expect(requireSessionOwnership(session, req)).toBeNull();
  });

  it("returns null (allow) for legacy sessions with no ownerId set", () => {
    // Pre-v0.26 sessions don't have an ownerId and remain open as
    // documented in the helper's comment. If we ever tighten this, the
    // test needs to be updated AND a migration plan written.
    const session = makeSession(undefined);
    const req = makeRequest({});
    expect(requireSessionOwnership(session, req)).toBeNull();
  });

  it("returns 403 when caller header is missing entirely", async () => {
    const session = makeSession("owner-uuid-123");
    const req = makeRequest({});
    const denied = requireSessionOwnership(session, req);
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
    const body = await denied!.json();
    expect(body.error).toMatch(/different browser/i);
  });

  it("returns 403 when caller header is empty string", async () => {
    const session = makeSession("owner-uuid-123");
    const req = makeRequest({ "X-Owner-Id": "" });
    const denied = requireSessionOwnership(session, req);
    // Empty string is not a match — explicit check, defends against the
    // case where a client sends the header but with no value.
    expect(denied!.status).toBe(403);
  });

  it("returns 403 when caller header does not match stored ownerId", async () => {
    const session = makeSession("owner-uuid-123");
    const req = makeRequest({ "X-Owner-Id": "different-uuid-xyz" });
    const denied = requireSessionOwnership(session, req);
    expect(denied!.status).toBe(403);
  });

  it("comparison is case-sensitive (UUIDs are normalized lowercase)", async () => {
    // crypto.randomUUID produces lowercase hex. A case-sensitive compare
    // protects against accidental case-confusion attacks where an
    // attacker uppercases the UUID.
    const session = makeSession("abc-def-123");
    const req = makeRequest({ "X-Owner-Id": "ABC-DEF-123" });
    const denied = requireSessionOwnership(session, req);
    expect(denied).not.toBeNull(); // case mismatch → denied
  });
});
