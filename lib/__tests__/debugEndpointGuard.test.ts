// Regression test for the production guard on /api/debug/code-analysis.
// The audit flagged this as critical: in production, the route runs the
// full tarball-download + tree-sitter-parse pipeline on any URL with no
// auth or rate limit — trivially weaponizable as worker-pinning DoS.
//
// We verify the gate by calling the route handlers directly with a
// stubbed NODE_ENV. The handlers live in `app/api/debug/code-analysis/`
// so a route-level test is awkward without Next request mocking; calling
// the exported handlers from a unit test gives us the same coverage of
// the gate logic without spinning up a request pipeline.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { GET, POST } from "../../app/api/debug/code-analysis/route";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setEnv(value: string | undefined) {
  // process.env values are typed string | undefined; assigning undefined
  // actually deletes the key, which is what we want for "no NODE_ENV set".
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }
}

describe("debug endpoint production guard", () => {
  beforeEach(() => setEnv(ORIGINAL_NODE_ENV));
  afterEach(() => setEnv(ORIGINAL_NODE_ENV));

  it("GET returns 404 when NODE_ENV=production", async () => {
    setEnv("production");
    const res = await GET(
      new Request("http://x/api/debug/code-analysis?repo=foo/bar")
    );
    expect(res.status).toBe(404);
  });

  it("POST returns 404 when NODE_ENV=production", async () => {
    setEnv("production");
    const res = await POST(
      new Request("http://x/api/debug/code-analysis", {
        method: "POST",
        body: JSON.stringify({ repoUrl: "https://github.com/foo/bar" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(404);
  });

  it("GET in non-production passes the guard (still 400 on missing input)", async () => {
    // Confirm the gate doesn't break dev/test access. Without the ?repo
    // arg the handler returns 400 — which is what we want to see, NOT 404.
    setEnv("development");
    const res = await GET(new Request("http://x/api/debug/code-analysis"));
    expect(res.status).toBe(400); // missing ?repo, NOT the gate
  });

  it("POST in non-production passes the guard (still 400 on invalid body)", async () => {
    setEnv("test");
    const res = await POST(
      new Request("http://x/api/debug/code-analysis", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400); // invalid body, NOT the gate
  });
});
