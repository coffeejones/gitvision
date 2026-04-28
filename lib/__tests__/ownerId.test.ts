// Tests for the v0.26 anonymous owner-id soft-isolation primitives.
//
// Pure functions only — getOrCreateOwnerId / getOwnerId interact with
// localStorage and would need a DOM environment, which our vitest
// config isn't set up for. The browser-API wrapper is a tiny shim;
// live testing during the v0.26 validation pass covers the
// localStorage roundtrip.

import { describe, it, expect } from "vitest";
import {
  filterSessionsByOwner,
  OWNER_ID_HEADER,
} from "../ownerId";

describe("OWNER_ID_HEADER constant", () => {
  it("matches the canonical case used on the wire", () => {
    // Header names are case-insensitive in HTTP, but we use a fixed form
    // so server logs / browser devtools display it consistently.
    expect(OWNER_ID_HEADER).toBe("X-Owner-Id");
  });
});

describe("filterSessionsByOwner", () => {
  const sessions = [
    { id: "a", ownerId: "alice" },
    { id: "b", ownerId: "bob" },
    { id: "c" }, // legacy, no ownerId
    { id: "d", ownerId: "alice" },
    { id: "e", ownerId: undefined }, // explicitly undefined
  ];

  it("returns ALL sessions when ownerId is null (pre-hydration / unknown caller)", () => {
    // Pre-hydration the caller hasn't read localStorage yet; server-
    // rendered first paint shows everything. Filter only narrows once
    // we know who's looking.
    const out = filterSessionsByOwner(sessions, null);
    expect(out).toHaveLength(5);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps sessions matching the caller's id", () => {
    const out = filterSessionsByOwner(sessions, "alice");
    expect(out.map((s) => s.id)).toContain("a");
    expect(out.map((s) => s.id)).toContain("d");
  });

  it("keeps legacy sessions (no ownerId at all) for everyone", () => {
    // Backward compat: pre-v0.26 sessions remain visible after the
    // migration so users don't lose their existing data.
    const out = filterSessionsByOwner(sessions, "alice");
    expect(out.map((s) => s.id)).toContain("c");
    expect(out.map((s) => s.id)).toContain("e");
  });

  it("hides sessions belonging to other owners", () => {
    const out = filterSessionsByOwner(sessions, "alice");
    expect(out.map((s) => s.id)).not.toContain("b");
  });

  it("returns full set + ownerless when caller has no matching sessions", () => {
    const out = filterSessionsByOwner(sessions, "carol");
    // carol has no sessions; only the legacy ones should remain
    expect(out.map((s) => s.id)).toEqual(["c", "e"]);
  });

  it("does not mutate the input array", () => {
    const before = sessions.length;
    filterSessionsByOwner(sessions, "alice");
    expect(sessions).toHaveLength(before);
  });

  it("returns a new array (callers can mutate the result safely)", () => {
    const out = filterSessionsByOwner(sessions, null);
    expect(out).not.toBe(sessions); // identity check
  });

  it("handles an empty input array", () => {
    expect(filterSessionsByOwner([], "alice")).toEqual([]);
    expect(filterSessionsByOwner([], null)).toEqual([]);
  });

  it("handles all-ownerless input (all legacy sessions)", () => {
    // Annotate the type so TS knows ownerId is at least optionally present
    // — without the annotation, T is narrowed to `{ id: string }` and the
    // generic's `extends { ownerId?: string }` constraint isn't satisfied.
    const legacyOnly: { id: string; ownerId?: string }[] = [
      { id: "x" },
      { id: "y" },
      { id: "z" },
    ];
    const out = filterSessionsByOwner(legacyOnly, "any-id");
    expect(out).toHaveLength(3);
  });

  it("handles all-owned input (all post-v0.26 sessions)", () => {
    const allOwned = [
      { id: "x", ownerId: "alice" },
      { id: "y", ownerId: "alice" },
      { id: "z", ownerId: "bob" },
    ];
    const out = filterSessionsByOwner(allOwned, "alice");
    expect(out.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("works with a generic record shape (Session vs SessionSummary)", () => {
    // The function is generic so the same helper drives both the
    // landing-page (SessionSummary) and any future detailed-list use
    // (full Session). Verify with a more complex shape.
    type Like = { id: string; ownerId?: string; extra?: string };
    const items: Like[] = [
      { id: "1", ownerId: "alice", extra: "foo" },
      { id: "2", extra: "bar" },
    ];
    const out = filterSessionsByOwner(items, "alice");
    expect(out).toEqual([
      { id: "1", ownerId: "alice", extra: "foo" },
      { id: "2", extra: "bar" },
    ]);
  });
});
