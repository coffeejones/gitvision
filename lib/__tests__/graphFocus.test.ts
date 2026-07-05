// Coverage for the focus-mode neighborhood BFS (lib/graphFocus.ts).

import { describe, it, expect } from "vitest";
import { neighborhood } from "../graphFocus";

// A small directed graph:  a → b → c → d ,  plus  e → b  (a second importer
// of b) and a self-edge on c. Directions read as "from imports to".
const edges = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
  { from: "c", to: "d" },
  { from: "e", to: "b" },
  { from: "c", to: "c" }, // self-edge — must be ignored
];

describe("neighborhood", () => {
  it("walks outgoing edges (what the root depends on)", () => {
    const n = neighborhood(edges, "a", { depth: 2, direction: "out", maxNodes: 50 });
    // a → b → c, but not d (3 hops)
    expect([...n.ids].sort()).toEqual(["a", "b", "c"]);
    expect(n.hops.get("a")).toBe(0);
    expect(n.hops.get("b")).toBe(1);
    expect(n.hops.get("c")).toBe(2);
    expect(n.dropped).toBe(0);
  });

  it("walks incoming edges (who depends on the root)", () => {
    const n = neighborhood(edges, "b", { depth: 1, direction: "in", maxNodes: 50 });
    // a and e both import b, at 1 hop
    expect([...n.ids].sort()).toEqual(["a", "b", "e"]);
    expect(n.hops.get("a")).toBe(1);
    expect(n.hops.get("e")).toBe(1);
  });

  it("unions both directions", () => {
    const n = neighborhood(edges, "b", { depth: 1, direction: "both", maxNodes: 50 });
    // in: a, e ; out: c ; plus root b
    expect([...n.ids].sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("records the minimum hop when a node is reachable by several paths", () => {
    // diamond: root → x → z and root → z directly. z is 1 hop, not 2.
    const diamond = [
      { from: "root", to: "x" },
      { from: "x", to: "z" },
      { from: "root", to: "z" },
    ];
    const n = neighborhood(diamond, "root", { depth: 3, direction: "out", maxNodes: 50 });
    expect(n.hops.get("z")).toBe(1);
  });

  it("ignores self-edges", () => {
    const n = neighborhood(edges, "c", { depth: 1, direction: "both", maxNodes: 50 });
    // c's real neighbors are b (in) and d (out) — never c itself via the self-edge
    expect(n.hops.get("c")).toBe(0);
    expect([...n.ids].sort()).toEqual(["b", "c", "d"]);
  });

  it("respects depth 0 (root only)", () => {
    const n = neighborhood(edges, "a", { depth: 0, direction: "both", maxNodes: 50 });
    expect([...n.ids]).toEqual(["a"]);
  });

  it("caps to maxNodes nearest-first and counts the dropped remainder", () => {
    // hub with 10 direct importers; cap at 4 keeps root + 3 nearest.
    const hub = Array.from({ length: 10 }, (_, i) => ({ from: `imp${i}`, to: "hub" }));
    const n = neighborhood(hub, "hub", { depth: 1, direction: "in", maxNodes: 4 });
    expect(n.ids.size).toBe(4);
    expect(n.ids.has("hub")).toBe(true); // root always survives the cap
    expect(n.dropped).toBe(7); // 11 reachable - 4 kept
  });
});
