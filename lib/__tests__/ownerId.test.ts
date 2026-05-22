// Tests for the v0.26 anonymous owner-id soft-isolation primitives.
//
// Pure functions only — getOrCreateOwnerId / getOwnerId interact with
// localStorage and would need a DOM environment, which our vitest
// config isn't set up for. The browser-API wrapper is a tiny shim;
// live testing during the v0.26 validation pass covers the
// localStorage roundtrip.

import { describe, it, expect } from "vitest";
import {
  DEMO_OWNER_ID,
  filterSessionsByOwner,
  filterSessionsByUser,
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

  describe("demo sessions (v0.52)", () => {
    it("hides demo-owned sessions from a matching caller", () => {
      const items = [
        { id: "user-a", ownerId: "alice" },
        { id: "demo-zod", ownerId: DEMO_OWNER_ID },
      ];
      const out = filterSessionsByOwner(items, "alice");
      expect(out.map((s) => s.id)).toEqual(["user-a"]);
    });

    it("hides demo sessions from a non-matching caller (still filtered)", () => {
      const items = [
        { id: "demo-zod", ownerId: DEMO_OWNER_ID },
        { id: "demo-flask", ownerId: DEMO_OWNER_ID },
        { id: "user-a", ownerId: "alice" },
      ];
      const out = filterSessionsByOwner(items, "bob");
      expect(out).toHaveLength(0);
    });

    it("hides demo sessions on the pre-hydration ownerId=null path", () => {
      // SSR first paint passes null ownerId. We must still hide demos
      // there so they don't briefly flash before client-side hydration.
      const items = [
        { id: "demo-zod", ownerId: DEMO_OWNER_ID },
        { id: "user-a", ownerId: "alice" },
        { id: "legacy" },
      ];
      const out = filterSessionsByOwner(items, null);
      expect(out.map((s) => s.id)).toEqual(["user-a", "legacy"]);
    });

    it('reserves "demo" as the canonical demo ownerId', () => {
      // Sentinel test — if anyone changes DEMO_OWNER_ID, on-disk demo
      // sessions tagged with the old value would silently start
      // appearing in user lists. Catching the rename forces a
      // matching data migration.
      expect(DEMO_OWNER_ID).toBe("demo");
    });
  });
});

describe("filterSessionsByUser (v0.76 — login-required model)", () => {
  // Annotated explicitly so the generic constraint `extends
  // { ownerId?: string; userId?: string }` is satisfied even when
  // all fields are omitted on a row.
  type Like = { id: string; ownerId?: string; userId?: string };

  const everything: Like[] = [
    { id: "u-alice", userId: "alice" },                       // alice's account-owned
    { id: "u-bob", userId: "bob" },                           // bob's account-owned
    { id: "u-alice-both", userId: "alice", ownerId: "ck-1" }, // alice's account + her cookie
    { id: "anon-1", ownerId: "ck-1" },                         // anonymous (pre-v0.76)
    { id: "anon-2", ownerId: "ck-2" },                         // anonymous, other cookie
    { id: "legacy" },                                          // pre-v0.26 — open
    { id: "demo-1", ownerId: DEMO_OWNER_ID },                  // demo — excluded
  ];

  it("returns [] for logged-out callers", () => {
    // Workspace listings are gated behind sign-in in the v0.76 model.
    // Logged-out visitors browse the marketing landing + demos only.
    expect(filterSessionsByUser(everything, null)).toEqual([]);
  });

  it("returns the caller's account-owned sessions + legacy-open", () => {
    const out = filterSessionsByUser(everything, "alice");
    expect(out.map((s) => s.id).sort()).toEqual([
      "legacy",
      "u-alice",
      "u-alice-both",
    ]);
  });

  it("does not include other users' sessions", () => {
    const out = filterSessionsByUser(everything, "alice");
    expect(out.map((s) => s.id)).not.toContain("u-bob");
  });

  it("hides anonymous ownerId-only sessions from logged-in callers", () => {
    // Anonymous sessions (pre-v0.76 ownerId-only, no userId) are
    // invisible in the workspace listing. They remain reachable by
    // direct URL — sharing isn't broken — but they don't surface as
    // "Your sessions" since there's no account binding.
    const out = filterSessionsByUser(everything, "alice");
    expect(out.map((s) => s.id)).not.toContain("anon-1");
    expect(out.map((s) => s.id)).not.toContain("anon-2");
  });

  it("hides demo sessions even from logged-in callers", () => {
    const out = filterSessionsByUser(everything, "alice");
    expect(out.map((s) => s.id)).not.toContain("demo-1");
  });

  it("returns new arrays (callers can mutate the result safely)", () => {
    const out = filterSessionsByUser(everything, "alice");
    expect(out).not.toBe(everything as unknown as Like[]);
  });

  it("handles an empty input", () => {
    expect(filterSessionsByUser([], "alice")).toEqual([]);
    expect(filterSessionsByUser([], null)).toEqual([]);
  });
});
