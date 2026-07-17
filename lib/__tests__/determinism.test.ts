import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cmpStr } from "../deterministicSort";

describe("cmpStr — locale-independent ordering", () => {
  it("orders by UTF-16 code point, not OS locale collation", () => {
    // Uppercase code points (65-90) precede lowercase (97-122). Locale collation
    // interleaves them (a before Z); cmpStr must not, or the same commit can
    // order differently on a non-English machine.
    expect(cmpStr("Z", "a")).toBeLessThan(0);
    expect(cmpStr("a", "Z")).toBeGreaterThan(0);
    expect(cmpStr("å", "z")).toBeGreaterThan(0); // å (229) > z (122), everywhere
    expect(cmpStr("x", "x")).toBe(0);
  });

  it("is a consistent total order (antisymmetric)", () => {
    const xs = ["banana", "Apple", "apple", "æble", "Zebra", "1file", "_hidden"];
    for (const a of xs)
      for (const b of xs) {
        // sign(a,b) + sign(b,a) === 0 for a total order (1+-1, 0+0). (Summing
        // avoids -0 !== 0 from negating Math.sign(0).)
        expect(Math.sign(cmpStr(a, b)) + Math.sign(cmpStr(b, a))).toBe(0);
      }
  });
});

describe("determinism guard — no locale-dependent sorts in the analysis engine", () => {
  // The "same commit → byte-identical analysis" guarantee dies the moment a
  // locale-free localeCompare sneaks back into a computed path. This fails the
  // build if one does; use cmpStr (deterministicSort) instead.
  it("has zero `.localeCompare(` calls under lib/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (entry.endsWith(".ts") && readFileSync(p, "utf8").includes(".localeCompare("))
          offenders.push(p.replace(process.cwd() + "/", ""));
      }
    };
    walk(join(process.cwd(), "lib"));
    expect(offenders).toEqual([]);
  });
});
