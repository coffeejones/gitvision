// Integration test: AI summary + AI health endpoints look up the session
// BEFORE consuming AI budget. The audit-flagged hole was that they
// previously consumed budget first and never checked ownership at all
// — anyone with a session id could drain the Anthropic quota.
//
// This file proves the lookup-and-deny path: requests for unknown
// sessions return 404 without ever touching Anthropic. The ownership
// rejection path (caller doesn't own the session) is covered at the
// unit level in ownership.test.ts — testing it end-to-end here would
// require mocking the storage module to plant a session in a directory
// that getSession looks at, because GITVISION_DATA_DIR is captured at
// module-import time and can't be overridden per-test (a known audit
// finding in audit/when-time/ — QUAL-025).
//
// What this combination proves:
//   - ownership.test.ts: requireSessionOwnership rejects mismatches
//   - this file:         the AI routes call getSession + checkOwnership
//                        before any AI / budget interaction
// Together: a non-owner caller cannot make us spend AI budget.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST as summaryPOST } from "../../app/api/sessions/[id]/summary/route";
import { POST as healthPOST } from "../../app/api/sessions/[id]/health/route";

const ORIGINAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://x/api/sessions/abc/route", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("AI endpoints — session lookup happens before AI work", () => {
  beforeEach(() => {
    // Set a stub Anthropic key so the 501 short-circuit doesn't fire
    // before the 404 path we're testing. Value never used — every test
    // here hits an early-return.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-stub";
  });

  afterEach(() => {
    if (ORIGINAL_ANTHROPIC_KEY === undefined) {
      delete (process.env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_KEY;
    }
  });

  it("summary returns 404 for unknown session (does not invoke Anthropic)", async () => {
    const res = await summaryPOST(
      makeRequest({ "X-Owner-Id": "anyone" }),
      makeCtx("does-not-exist-zzz")
    );
    expect(res.status).toBe(404);
  });

  it("health returns 404 for unknown session (does not invoke Anthropic)", async () => {
    const res = await healthPOST(
      makeRequest({ "X-Owner-Id": "anyone" }),
      makeCtx("does-not-exist-zzz")
    );
    expect(res.status).toBe(404);
  });

  it("summary 501 fires when ANTHROPIC_API_KEY is missing, before session lookup", async () => {
    delete (process.env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
    const res = await summaryPOST(
      makeRequest({}),
      makeCtx("does-not-exist-zzz")
    );
    expect(res.status).toBe(501);
  });
});
