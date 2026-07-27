// The one-time opt-in before a private repository's source leaves the machine.
//
// The per-function explainer is the only path in the product that sends file
// contents to a model. The prompt existed, but it lived inside FunctionInsight,
// so it guarded the Source view and nothing else — FlowsView called the same
// endpoint on a node click and sent private source with no prompt at all. That
// is the surface a reader clicks around in most casually, so it was the one
// that needed the gate most.
//
// The helper is shared now. These tests pin its two directions (public never
// asks, private asks once) and the failure mode that matters: when storage is
// unavailable we must ask AGAIN rather than assume consent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  hasPrivateExplainConsent,
  grantPrivateExplainConsent,
  needsPrivateExplainConsent,
} from "../explainConsent";

const KEY = "ct-explain-consent-private";

/** Minimal localStorage stand-in; vitest's node environment has none. */
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Partial<Storage> = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", { localStorage: { ...base, ...impl } });
  return store;
}

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

describe("private-repo explain consent", () => {
  it("never asks for a public repository", () => {
    // Its source is already readable by anyone; a prompt would be theatre.
    expect(needsPrivateExplainConsent(false)).toBe(false);
  });

  it("asks the first time on a private repository, then stops", () => {
    expect(needsPrivateExplainConsent(true)).toBe(true);

    grantPrivateExplainConsent();

    expect(hasPrivateExplainConsent()).toBe(true);
    expect(needsPrivateExplainConsent(true)).toBe(false);
  });

  it("asks again when storage cannot be read", () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError: storage blocked");
      },
    });
    expect(hasPrivateExplainConsent()).toBe(false);
    expect(needsPrivateExplainConsent(true)).toBe(true);
  });

  it("does not throw, or claim consent, when the write fails", () => {
    installStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });

    expect(() => grantPrivateExplainConsent()).not.toThrow();
    // Private browsing: the opt-in could not be recorded, so the next visit
    // asks again. Erring toward asking is the safe direction.
    expect(hasPrivateExplainConsent()).toBe(false);
  });

  it("writes the flag the UI and older builds already look for", () => {
    const store = installStorage();
    grantPrivateExplainConsent();
    expect(store.get(KEY)).toBe("1");
  });
});

describe("every explain surface goes through the shared gate", () => {
  // A source guard: the defect was one surface calling the endpoint directly,
  // and the cheapest way for it to come back is a new view doing the same.
  const views = ["FunctionInsight", "FlowsView"];

  for (const view of views) {
    it(`${view} asks before sending a private repo's source`, () => {
      const src = readFileSync(
        path.join(process.cwd(), "components", "views", `${view}.tsx`),
        "utf-8",
      );
      expect(src).toContain("source/explain");
      expect(
        src.includes("needsPrivateExplainConsent"),
        `${view} calls the explain endpoint without consulting the consent gate`,
      ).toBe(true);
      expect(src).toContain("grantPrivateExplainConsent");
    });
  }
});
