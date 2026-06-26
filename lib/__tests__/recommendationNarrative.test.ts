// The recommendation-narrative generator wraps an Anthropic call, so the live
// path isn't unit-tested. We lock the safe-degradation contract that does NOT
// touch the network: an empty recommendation list (a clean repo) yields null —
// the caller then renders the deterministic cards with no AI lead-in — and the
// call never throws.

import { describe, it, expect } from "vitest";
import { generateRecommendationNarrative } from "../intelligence/recommendationNarrative";

describe("generateRecommendationNarrative — safe degradation", () => {
  it("returns null for an empty recommendation list without calling the API", async () => {
    const result = await generateRecommendationNarrative(
      { items: [], topActions: [] },
      "owner/repo"
    );
    expect(result).toBeNull();
  });
});
