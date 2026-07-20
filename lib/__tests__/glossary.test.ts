import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOSSARY, glossary, type GlossaryKey } from "../glossary";

// The set of section ids that actually exist on /help. Extracted from the
// page source so a renamed/removed anchor fails this test instead of silently
// shipping a "Read more →" link to nowhere.
function helpAnchors(): Set<string> {
  const src = readFileSync(
    join(__dirname, "..", "..", "app", "help", "page.tsx"),
    "utf8"
  );
  const ids = new Set<string>();
  for (const m of src.matchAll(/id:\s*"([a-z0-9-]+)"/g)) ids.add(m[1]);
  return ids;
}

describe("glossary", () => {
  const keys = Object.keys(GLOSSARY) as GlossaryKey[];

  it("has entries", () => {
    expect(keys.length).toBeGreaterThan(8);
  });

  it("every entry carries a term, a 'what', and a 'why'", () => {
    for (const k of keys) {
      const e = glossary(k);
      expect(e.term, `${k}.term`).toBeTruthy();
      expect(e.what.length, `${k}.what`).toBeGreaterThan(20);
      expect(e.why.length, `${k}.why`).toBeGreaterThan(20);
    }
  });

  it("every anchor points to a real /help section id", () => {
    const anchors = helpAnchors();
    for (const k of keys) {
      const a = glossary(k).anchor;
      if (a) expect(anchors, `${k}.anchor "${a}"`).toContain(a);
    }
  });
});
