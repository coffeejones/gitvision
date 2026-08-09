// Weak-Suite assertion extraction in the JS/TS plugin (Arc 1). Verifies the
// per-test-case classification: meaningful vs trivial oracles, no-assertion
// smoke tests, chained assertions counted once, skipped tests excluded, node
// `assert`, describe/it nesting, and test.each.

import { describe, it, expect, beforeAll } from "vitest";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { parseFile } from "../codeAnalysis/parse";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { FileIndex, SourceFile, TestCaseMeta } from "../codeAnalysis/types";

function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras: new Map() };
}

const SPEC = `
import { add } from "./math";
import assert from "node:assert";

describe("math", () => {
  it("adds numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
  it("is truthy", () => {
    const r = add(1, 2);
    expect(r).toBeDefined();
  });
  it("just runs", () => {
    add(1, 2);
  });
  it("negated equal", () => {
    expect(add(1, 1)).not.toBe(5);
  });
  it("two asserts", () => {
    expect(add(1, 1)).toBe(2);
    expect(add(0, 0)).toBeTruthy();
  });
  it.skip("skipped", () => {
    expect(add(1, 1)).toBe(2);
  });
  it("node assert", () => {
    assert.equal(add(2, 2), 4);
  });
  it("assert ok only", () => {
    assert.ok(add(1, 1));
  });
});

test.each([1, 2])("each %s", (n) => {
  expect(n).toBeGreaterThan(0);
});
`;

describe("Weak-Suite extraction (JS/TS plugin)", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  function extract() {
    const file: SourceFile = { rel: "src/math.test.ts", ext: "ts", content: SPEC };
    const ix = makeIndex([file]);
    const parsed = parseFile(javascriptPlugin, file, ix);
    return parsed.testMeta;
  }

  function byName(cases: TestCaseMeta[]): Map<string, TestCaseMeta> {
    return new Map(cases.map((c) => [c.name, c]));
  }

  it("finds every runnable test case and excludes skipped ones", () => {
    const meta = extract();
    expect(meta).toBeDefined();
    const names = meta!.cases.map((c) => c.name).sort();
    expect(names).toEqual([
      "adds numbers",
      "assert ok only",
      "each %s",
      "is truthy",
      "just runs",
      "negated equal",
      "node assert",
      "two asserts",
    ]);
    expect(names).not.toContain("skipped");
  });

  it("classifies meaningful vs trivial oracles", () => {
    const m = byName(extract()!.cases);
    // Meaningful value checks
    expect(m.get("adds numbers")).toMatchObject({ assertions: 1, trivialAssertions: 0, hasMeaningfulOracle: true });
    expect(m.get("node assert")).toMatchObject({ assertions: 1, trivialAssertions: 0, hasMeaningfulOracle: true });
    expect(m.get("each %s")).toMatchObject({ assertions: 1, hasMeaningfulOracle: true });
    // Trivial / smoke oracles
    expect(m.get("is truthy")).toMatchObject({ assertions: 1, trivialAssertions: 1, hasMeaningfulOracle: false });
    expect(m.get("assert ok only")).toMatchObject({ assertions: 1, trivialAssertions: 1, hasMeaningfulOracle: false });
  });

  it("counts a no-assertion test as zero assertions (pure smoke)", () => {
    const m = byName(extract()!.cases);
    expect(m.get("just runs")).toMatchObject({ assertions: 0, hasMeaningfulOracle: false });
  });

  it("counts a chained assertion exactly once (no expect()+matcher double-count)", () => {
    const m = byName(extract()!.cases);
    expect(m.get("negated equal")).toMatchObject({ assertions: 1, trivialAssertions: 0, hasMeaningfulOracle: true });
  });

  it("tallies multiple assertions in one case, mixing meaningful + trivial", () => {
    const m = byName(extract()!.cases);
    expect(m.get("two asserts")).toMatchObject({ assertions: 2, trivialAssertions: 1, hasMeaningfulOracle: true });
  });

  it("collects the trivial-oracle idiom names as evidence", () => {
    const meta = extract()!;
    expect(meta.trivialOracleNames).toEqual(["ok", "toBeDefined", "toBeTruthy"]);
  });

  it("attaches testMeta to the code graph and skips non-test files", () => {
    const spec: SourceFile = { rel: "src/a.test.ts", ext: "ts", content: SPEC };
    const src: SourceFile = { rel: "src/math.ts", ext: "ts", content: "export function add(a,b){return a+b;}" };
    const ix = makeIndex([spec, src]);
    const g = buildCodeGraph({
      parsedFiles: [parseFile(javascriptPlugin, spec, ix), parseFile(javascriptPlugin, src, ix)],
      pluginByFile: new Map([
        ["src/a.test.ts", "javascript"],
        ["src/math.ts", "javascript"],
      ]),
    });
    expect(g.testFiles).toBeDefined();
    expect(g.testFiles!.map((t) => t.file)).toEqual(["src/a.test.ts"]);
    expect(g.testFiles![0].cases.length).toBe(8);
  });
});

// Real-world idioms the naive first cut mis-scored (caught by adversarial review).
describe("Weak-Suite extraction — real-world idioms", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  function metaOf(content: string) {
    const file: SourceFile = { rel: "src/x.spec.ts", ext: "ts", content };
    const ix = makeIndex([file]);
    return parseFile(javascriptPlugin, file, ix).testMeta;
  }
  const named = (m: ReturnType<typeof metaOf>) =>
    new Map((m?.cases ?? []).map((c) => [c.name, c]));

  it("does not count Playwright describe/hooks/steps as cases, and steps feed the parent", () => {
    const meta = metaOf(`
      test.describe("checkout", () => {
        test.beforeEach(async ({ page }) => { await page.goto("/"); });
        test("adds to cart", async ({ page }) => {
          await test.step("open", async () => { expect(page.url()).toBe("/p"); });
          await test.step("add", async () => { expect(await page.textContent(".c")).toContain("1"); });
        });
        test.only("checkout flow", async ({ page }) => {
          expect(page.url()).toBe("/checkout");
        });
      });
    `);
    const m = named(meta);
    // Only the two real tests are cases — not describe, beforeEach, or the steps.
    expect([...m.keys()].sort()).toEqual(["adds to cart", "checkout flow"]);
    // test.step assertions count toward the enclosing test (2, both meaningful).
    expect(m.get("adds to cart")).toMatchObject({ assertions: 2, trivialAssertions: 0, hasMeaningfulOracle: true });
    expect(m.get("checkout flow")).toMatchObject({ assertions: 1, hasMeaningfulOracle: true });
  });

  it("scores chai property-getter assertions (.to.be.true meaningful, .to.be.null trivial)", () => {
    const m = named(metaOf(`
      describe("validate", () => {
        it("accepts", () => { expect(validate("ok")).to.be.true; });
        it("rejects", () => { expect(validate("bad")).to.be.false; });
        it("empty is null", () => { expect(find("")).to.be.null; });
        it("call form", () => { expect(sum(1, 2)).to.equal(3); });
      });
    `));
    expect(m.get("accepts")).toMatchObject({ assertions: 1, trivialAssertions: 0, hasMeaningfulOracle: true });
    expect(m.get("rejects")).toMatchObject({ assertions: 1, hasMeaningfulOracle: true });
    expect(m.get("empty is null")).toMatchObject({ assertions: 1, trivialAssertions: 1, hasMeaningfulOracle: false });
    expect(m.get("call form")).toMatchObject({ assertions: 1, hasMeaningfulOracle: true });
  });

  it("counts vitest expect.soft(...) assertions (not dropped)", () => {
    const m = named(metaOf(`
      it("soft", () => {
        expect.soft(a).toBe(1);
        expect.soft(b).toBeDefined();
      });
    `));
    expect(m.get("soft")).toMatchObject({ assertions: 2, trivialAssertions: 1, hasMeaningfulOracle: true });
  });

  it("handles namespaced chai.assert.equal", () => {
    const m = named(metaOf(`
      it("ns assert", () => { chai.assert.equal(add(1, 1), 2); });
    `));
    expect(m.get("ns assert")).toMatchObject({ assertions: 1, trivialAssertions: 0, hasMeaningfulOracle: true });
  });
});

// Assertions reached through a local helper. This is not a cosmetic count:
// `hollow-tests-added` sits in the conscience gate's BLOCKING_KINDS, and the
// agent prompt says to "remove the hollow assertion" and treat the gate as a
// stop — so a false hollow verdict is an instruction to delete real coverage.
// Measured on this repo: 24 cases scored as asserting nothing did assert,
// every one of them through a helper.
describe("weakSuite — assertions behind a helper", () => {
  const meta = (src: string) => {
    const file: SourceFile = { rel: "x.test.ts", ext: "ts", content: src };
    return parseFile(javascriptPlugin, file, makeIndex([file])).testMeta;
  };

  it("counts a case that asserts only through a local helper", () => {
    const m = meta(
      'const expectStatus = (s, id, v) => expect(s[id]).toBe(v);\n' +
        'it("checks a dimension", () => { expectStatus(s, "hygiene", "healthy"); });\n',
    );
    expect(m?.cases[0].assertions).toBe(1);
    expect(m?.cases[0].hasMeaningfulOracle).toBe(true);
  });

  it("carries the helper's weakness through, rather than laundering it", () => {
    // A helper whose only matcher is trivial does not become meaningful by
    // being wrapped in a function.
    const m = meta(
      'const exists = (x) => expect(x).toBeDefined();\n' +
        'it("smoke", () => { exists(thing); });\n',
    );
    expect(m?.cases[0].assertions).toBe(1);
    expect(m?.cases[0].hasMeaningfulOracle).toBe(false);
  });

  it("still reports a case that genuinely asserts nothing", () => {
    const m = meta('it("runs and hopes", () => { doTheThing(); });\n');
    expect(m?.cases[0].assertions).toBe(0);
    expect(m?.cases[0].hasMeaningfulOracle).toBe(false);
  });

  it("counts one assertion per helper CALL, not per assertion inside it", () => {
    const m = meta(
      'function checkBoth(a, b) { expect(a).toBe(1); expect(b).toBe(2); }\n' +
        'it("one call", () => { checkBoth(x, y); });\n',
    );
    expect(m?.cases[0].assertions).toBe(1);
  });

  it("does not treat an ordinary function call as an assertion", () => {
    const m = meta(
      'const build = (n) => ({ id: n });\n' +
        'it("no oracle", () => { const r = build(1); });\n',
    );
    expect(m?.cases[0].assertions).toBe(0);
  });
});

// The helper lookup, once it had to survive real test files.
//
// Two defects shipped with the helper pass in 1c212f1, both from the same
// simplification: a flat name→helper map over the whole file, with no notion of
// where a name is visible or where its assertions actually run.
//
// Neither changes a number on this repo — measured, 2,482 cases, byte-identical
// before and after — nor on the 773 third-party cases inside node_modules. They
// are latent, and the shape is not exotic: 20 of this repo's 642 source files
// already declare the same local function name in more than one scope. None of
// those collisions happens to involve an asserting helper. That is luck.
describe("weakSuite — the helper lookup respects scope and execution", () => {
  const meta = (src: string) => {
    const file: SourceFile = { rel: "x.test.ts", ext: "ts", content: src };
    return parseFile(javascriptPlugin, file, makeIndex([file])).testMeta;
  };
  const byName = (src: string) =>
    new Map((meta(src)?.cases ?? []).map((c) => [c.name, c]));

  it("does not credit one describe's helper to another describe's calls", () => {
    // Sibling blocks each declaring `check` is ordinary test-file writing. The
    // flat map kept whichever was registered and handed it to both, so the
    // hollow case scored 1 assertion with a meaningful oracle.
    const m = byName(
      'describe("a", () => {\n' +
        '  const check = (x) => expect(x).toBe(1);\n' +
        '  it("real", () => { check(1); });\n' +
        '});\n' +
        'describe("b", () => {\n' +
        '  const check = (x) => x;\n' +
        '  it("hollow", () => { check(1); });\n' +
        '});\n',
    );
    expect(m.get("real")).toMatchObject({ assertions: 1, hasMeaningfulOracle: true });
    expect(
      m.get("hollow"),
      "a hollow case borrowed a sibling block's helper",
    ).toMatchObject({ assertions: 0, hasMeaningfulOracle: false });
  });

  it("prefers the innermost declaration when a name is shadowed", () => {
    // The other direction: an outer helper asserts trivially, the inner one
    // meaningfully. Whichever wins must be the one the call actually reaches.
    const m = byName(
      'const check = (x) => expect(x).toBeDefined();\n' +
        'describe("inner", () => {\n' +
        '  const check = (x) => expect(x).toBe(1);\n' +
        '  it("uses the inner one", () => { check(1); });\n' +
        '});\n' +
        'it("uses the outer one", () => { check(1); });\n',
    );
    expect(m.get("uses the inner one")).toMatchObject({ hasMeaningfulOracle: true });
    expect(m.get("uses the outer one")).toMatchObject({
      trivialAssertions: 1,
      hasMeaningfulOracle: false,
    });
  });

  it("counts a helper declared inside its own case exactly once per call", () => {
    // The declaration sits in the case body, so the lexical walk counted its
    // expect AND the call counted again: defined once, called once scored 2.
    const m = meta(
      'it("a", () => {\n' +
        '  const check = (v) => expect(v).toBe(1);\n' +
        '  check(2);\n' +
        '});\n',
    );
    expect(m?.cases[0].assertions).toBe(1);
  });

  it("does not let the overcount scale with the number of calls", () => {
    const m = meta(
      'it("a", () => {\n' +
        '  const check = (v) => expect(v).toBe(1);\n' +
        '  check(1); check(2); check(3);\n' +
        '});\n',
    );
    expect(m?.cases[0].assertions, "one lexical expect plus three calls").toBe(3);
  });

  it("still counts a function the case defines but never calls by name", () => {
    // MEASURED, not assumed: zod's v3/tests/error.test.ts:154 declares
    // `errorMap`, asserts inside it, and hands it to safeParse — which invokes
    // it. Skipping every declaration scored that case 2 where it asserts 3
    // times. Undercounting is the dangerous direction here, because a false
    // hollow verdict blocks the conscience gate and reads as "delete this test".
    const m = meta(
      'it("a", () => {\n' +
        '  const cb = (e) => { expect(e.path.length).toBe(2); return 1; };\n' +
        '  const r = parse(input, { cb });\n' +
        '  expect(r.ok).toEqual(false);\n' +
        '});\n',
    );
    expect(m?.cases[0].assertions).toBe(2);
  });

  it("leaves a helper declared outside every case exactly as it was", () => {
    // The path 1c212f1 was written for. It must not move.
    const m = meta(
      'const check = (v) => expect(v).toBe(1);\n' + 'it("a", () => { check(1); });\n',
    );
    expect(m?.cases[0].assertions).toBe(1);
    expect(m?.cases[0].hasMeaningfulOracle).toBe(true);
  });
});
