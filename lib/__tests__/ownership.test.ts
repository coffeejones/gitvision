// Regression tests for lib/ownership.ts. The shared helper guards four
// mutating endpoint families (session DELETE/PATCH, AI summary, AI
// health, refresh). Two of those — summary and health — were the
// audit-flagged holes: they had no ownership check at all, leaving the
// Anthropic budget exposed to anyone who knew a session id. This file
// pins the contract so a future extraction or rename can't quietly
// drop the check from any caller.
//
// We test the pure `checkSessionOwnership` function rather than the
// request-bound wrapper so the tests don't need to mock Better Auth.
// `requireSessionOwnership` is a thin two-line composition over the
// pure function; if the pure function is right and the composition
// compiles, the wrapper is right.

import { describe, it, expect } from "vitest";
import { checkSessionOwnership } from "../ownership";

describe("checkSessionOwnership", () => {
  // ─── Legacy / ownerId path ──────────────────────────────────────

  it("allows when callerOwnerId matches session.ownerId", () => {
    expect(
      checkSessionOwnership({ ownerId: "owner-uuid-123" }, null, "owner-uuid-123")
    ).toBe("allowed");
  });

  it("allows legacy sessions with no ownerId AND no userId", () => {
    // Pre-v0.26 sessions had neither field. Documented as "open" so
    // existing-anonymous sessions don't break after upgrades. If we
    // ever tighten this, the test needs an update AND a migration plan.
    expect(checkSessionOwnership({}, null, null)).toBe("allowed");
    expect(checkSessionOwnership({}, null, "any-cookie")).toBe("allowed");
  });

  it("denies when callerOwnerId is missing on an owned session", () => {
    expect(
      checkSessionOwnership({ ownerId: "owner-uuid-123" }, null, null)
    ).toBe("denied");
  });

  it("denies when callerOwnerId is empty string", () => {
    // Defends the case where a client sends the header but with no
    // value. Empty string ≠ stored ownerId.
    expect(
      checkSessionOwnership({ ownerId: "owner-uuid-123" }, null, "")
    ).toBe("denied");
  });

  it("denies when callerOwnerId doesn't match", () => {
    expect(
      checkSessionOwnership(
        { ownerId: "owner-uuid-123" },
        null,
        "different-uuid-xyz"
      )
    ).toBe("denied");
  });

  it("is case-sensitive on the ownerId comparison", () => {
    // crypto.randomUUID produces lowercase hex. A case-sensitive
    // compare protects against accidental case-confusion attacks.
    expect(
      checkSessionOwnership({ ownerId: "abc-def-123" }, null, "ABC-DEF-123")
    ).toBe("denied");
  });

  // ─── Strong claim / userId path (v0.76+) ────────────────────────

  it("allows when callerUserId matches session.userId", () => {
    expect(
      checkSessionOwnership({ userId: "user_123" }, "user_123", null)
    ).toBe("allowed");
  });

  it("denies when callerUserId doesn't match userId, even if ownerId would have matched", () => {
    // Once a session is bound to a user, the cookie no longer overrides.
    // The original cookie creator can't modify the session anymore via
    // ownerId alone — they have to be signed in as the user. Otherwise
    // a shared / inherited browser session could mutate account-owned
    // sessions.
    expect(
      checkSessionOwnership(
        { userId: "user_123", ownerId: "owner-uuid-original" },
        null,
        "owner-uuid-original"
      )
    ).toBe("denied");
  });

  it("denies when callerUserId is null on a user-owned session", () => {
    // Not logged in, but the session has a userId → denied.
    expect(
      checkSessionOwnership({ userId: "user_123" }, null, "any-cookie")
    ).toBe("denied");
  });

  it("allows the rightful user when both ids match", () => {
    expect(
      checkSessionOwnership(
        { userId: "user_123", ownerId: "owner-uuid-original" },
        "user_123",
        "owner-uuid-original"
      )
    ).toBe("allowed");
  });

  it("allows the rightful user even when the cookie differs", () => {
    // Same user, different machine (different cookie) → still allowed.
    // The account-level claim is what matters.
    expect(
      checkSessionOwnership(
        { userId: "user_123", ownerId: "owner-uuid-original" },
        "user_123",
        "different-cookie-on-laptop"
      )
    ).toBe("allowed");
  });
});
