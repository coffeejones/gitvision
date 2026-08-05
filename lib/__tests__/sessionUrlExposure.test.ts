// What a session URL is worth, pinned.
//
// Two things were unclear enough to be worth writing down as tests rather than
// prose, because both are easy to change by accident:
//
//   1. An ownerless session is readable by anyone, private repo or not. That is
//      DELIBERATE — lib/githubApp/pipeline.ts creates ownerless sessions for
//      both sides of every PR the bot analyses so the link in its comment opens
//      without a login. lib/github.ts used to claim the opposite ("gate
//      private-repo sessions to the owner only"), which is the kind of comment
//      that gets believed. If someone later decides unlisted is not good enough,
//      this test is where the decision gets reversed on purpose.
//
//   2. Because the URL is the capability, it must not travel to third parties.
//      Measured: every current browser already defaults to
//      strict-origin-when-cross-origin, and a real cross-origin navigation out
//      of a session page sent only `Referer: http://localhost:3011/`. The header
//      in next.config.ts removes the reliance on that default; it does not close
//      an open leak, and this file should not imply otherwise.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { checkSessionReadAccess } from "../ownership";
import type { Session } from "../types";

const read = (...p: string[]) =>
  readFileSync(path.join(process.cwd(), ...p), "utf-8");

function session(over: Partial<Session>): Session {
  return {
    id: "s1",
    name: "acme/widget",
    snapshots: [{ repo: { fullName: "acme/widget", private: true } }],
    ...over,
  } as unknown as Session;
}

describe("who can read a private session", () => {
  it("keeps an owned one owner-only", () => {
    const owned = session({ userId: "user-a" });
    expect(checkSessionReadAccess(owned, "user-a", null)).toBe("allowed");
    expect(checkSessionReadAccess(owned, "user-b", null)).toBe("denied");
    expect(checkSessionReadAccess(owned, null, null)).toBe("denied");
  });

  it("keeps a legacy owner-id one owner-only", () => {
    const legacy = session({ ownerId: "owner-a" });
    expect(checkSessionReadAccess(legacy, null, "owner-a")).toBe("allowed");
    expect(checkSessionReadAccess(legacy, null, "owner-b")).toBe("denied");
    expect(checkSessionReadAccess(legacy, null, null)).toBe("denied");
  });

  it("serves an OWNERLESS one to anyone, even on a private repo", () => {
    // Deliberate, and the one people find surprising. Changing this breaks the
    // PR bot's deep link for anyone not signed in — decide that on purpose.
    const ownerless = session({});
    expect(ownerless.userId).toBeUndefined();
    expect(ownerless.ownerId).toBeUndefined();
    expect(checkSessionReadAccess(ownerless, null, null)).toBe("allowed");
  });

  it("is the shape the PR bot actually creates", () => {
    // The test above is only meaningful if something really makes such a
    // session. pipeline.ts calls createSession without ownerId or userId.
    const src = read("lib", "githubApp", "pipeline.ts");
    const calls = [...src.matchAll(/deps\.createSession\(\{[\s\S]*?\n {4}\}\)/g)];
    expect(calls.length, "pipeline.ts no longer creates sessions this way").toBe(2);
    for (const [call] of calls) {
      expect(call).not.toContain("ownerId");
      expect(call).not.toContain("userId");
    }
  });

  it("does not let lib/github.ts promise owner-only again", () => {
    // The comment that was wrong. Not a style check — it described a guarantee
    // the code does not make, next to the field that is supposed to enforce it.
    const src = read("lib", "github.ts");
    expect(src).not.toContain("gate private-repo sessions\n    // to the owner only");
    expect(src, "the ownerless caveat was dropped").toContain("Unlisted, not gated");
  });
});

describe("the session URL does not travel", () => {
  it("sets a Referrer-Policy on every route", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain("Referrer-Policy");
    expect(cfg).toContain("strict-origin-when-cross-origin");
    // Site-wide. A policy scoped to /session would miss the API routes, which
    // carry the same id in the same position.
    expect(cfg).toContain('source: "/:path*"');
  });

  it("loads no third-party script, image or beacon from a session page", () => {
    // The policy governs what LEAVES with a request. The other half is not
    // making requests to third parties at all: an external <img> or analytics
    // beacon on a session page would carry the same Referer.
    for (const dir of ["components", "app"]) {
      const files = listFiles(path.join(process.cwd(), dir), ".tsx");
      for (const f of files) {
        const src = readFileSync(f, "utf-8");
        const external = src.match(/<(?:img|script|iframe)[^>]*src="https?:\/\//g);
        expect(external, `${path.relative(process.cwd(), f)} loads a third party`).toBeNull();
      }
    }
  });

  it("has nothing overriding the policy per-link", () => {
    // A single referrerpolicy="unsafe-url" would put the full path back on the
    // wire for that one link, and it would be invisible in review.
    for (const dir of ["components", "app"]) {
      for (const f of listFiles(path.join(process.cwd(), dir), ".tsx")) {
        expect(readFileSync(f, "utf-8")).not.toContain("unsafe-url");
      }
    }
  });
});

function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, ext));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}
