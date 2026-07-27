// Pricing must not advertise what the product cannot do.
//
// This exists because Pro ($39/mo) shipped a "Team workspaces (multi-user)"
// bullet — on the card AND as a ✓ in the comparison table — for a feature with
// no implementation anywhere: lib/db/schema.ts defines user, session, account,
// verification and watch, and nothing else. There is no team, no organization,
// no membership, and no gate that ever read the flag. A buyer who upgrades for
// that bullet and then goes looking for the invite screen learns something
// about us that no amount of landing-page work undoes.
//
// The flag is kept in TierLimits so the gate exists the day teams ship. These
// tests make sure it cannot be sold again before that day: turning it on will
// fail here, which is the moment to check that an implementation actually
// exists rather than the moment a customer checks for you.

import { describe, it, expect } from "vitest";
import { TIER_CONFIG, TIER_ORDER } from "../pricing";

/** Capabilities that are configured but have no implementation behind them.
 *  Delete an entry here when — and only when — the feature actually ships. */
const UNIMPLEMENTED: Array<{
  flag: "teamWorkspaces";
  why: string;
}> = [
  {
    flag: "teamWorkspaces",
    why: "no team/org/membership model exists (lib/db/schema.ts has user, session, account, verification, watch)",
  },
];

describe("pricing does not sell unimplemented capabilities", () => {
  for (const { flag, why } of UNIMPLEMENTED) {
    it(`${flag} is off on every tier — ${why}`, () => {
      for (const tierId of TIER_ORDER) {
        expect(
          TIER_CONFIG[tierId].limits[flag],
          `${TIER_CONFIG[tierId].name} grants ${flag}, but ${why}. Either ship it or leave the flag false.`
        ).toBe(false);
      }
    });
  }

  it("no feature bullet promises multi-user or team functionality", () => {
    // The flag being false is not enough on its own — the bullets are free
    // text, and the original defect was as much a sentence on a card as it was
    // a boolean. Catch the wording too.
    const forbidden = /team workspace|multi-user|multi user|invite your team|seats?\b/i;
    for (const tierId of TIER_ORDER) {
      const tier = TIER_CONFIG[tierId];
      for (const bullet of tier.featureBullets) {
        expect(
          forbidden.test(bullet),
          `${tier.name} advertises "${bullet}", which promises team functionality the product does not have`
        ).toBe(false);
      }
      expect(
        forbidden.test(tier.tagline),
        `${tier.name}'s tagline "${tier.tagline}" promises team functionality the product does not have`
      ).toBe(false);
    }
  });
});
