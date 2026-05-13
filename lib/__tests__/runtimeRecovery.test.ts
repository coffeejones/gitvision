// Regression test for the ensureRuntime cached-rejection bug. Before the
// fix, a single failed init (transient disk hiccup, missing WASM during
// redeploy, OOM at startup) cached a rejected Promise forever — every
// subsequent caller hit the cache and got the same rejection, leaving
// the entire code-analysis pipeline broken until process restart.
//
// We can't easily force a real init failure mid-test without mocking
// fs.readFile, which would over-couple to implementation. Instead we
// verify the contract directly: after we explicitly reset the singleton
// (the same hook the catch-handler uses on rejection), the next call
// re-runs init and succeeds. That covers the recovery path the fix
// installs.

import { describe, it, expect } from "vitest";
import { ensureRuntime, _resetRuntimeForTests } from "../codeAnalysis/runtime";

describe("ensureRuntime", () => {
  it("succeeds on a fresh process", async () => {
    await expect(ensureRuntime()).resolves.toBeUndefined();
  });

  it("returns the cached promise on repeat calls (no re-init)", async () => {
    // Two adjacent calls should resolve to the same promise object — the
    // whole point of the singleton.
    const a = ensureRuntime();
    const b = ensureRuntime();
    expect(a).toBe(b);
    await a;
  });

  it("re-runs init after a manual reset (the recovery path)", async () => {
    // First boot
    await ensureRuntime();
    // Simulate a process where the cached promise was cleared — the same
    // hook the catch-handler uses on rejection.
    _resetRuntimeForTests();
    // Subsequent call should NOT throw the previously-cached rejection;
    // it should re-init fresh and succeed.
    await expect(ensureRuntime()).resolves.toBeUndefined();
  });
});
