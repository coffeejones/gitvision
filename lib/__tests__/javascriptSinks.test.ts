// DOM XSS detection in JavaScript — the first non-Python sink set.
//
// The negatives are the whole point. `el.innerHTML = x` is one of the most
// common lines in front-end code and is usually harmless; the rule earns its
// place only by staying silent on it. Measured: zero findings on this repo
// (~1200 TS files) and on a real React frontend.

import { describe, it, expect, beforeAll } from "vitest";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { parseFile } from "../codeAnalysis/parse";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

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

describe("javascriptPlugin — DOM XSS sinks", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  const sinksIn = (content: string, rel = "app.js") => {
    const file: SourceFile = { rel, ext: "js", content };
    return parseFile(javascriptPlugin, file, makeIndex([file])).sinks ?? [];
  };
  const ruleIds = (content: string) => sinksIn(content).map((s) => s.ruleId);

  it("flags innerHTML assigned a value from the URL", () => {
    const src =
      "function show() {\n" +
      "  const q = location.hash;\n" +
      "  document.getElementById('out').innerHTML = q;\n" +
      "}\n";
    expect(ruleIds(src)).toEqual(["js-dom-xss"]);
  });

  it("flags document.write on a URL-derived value", () => {
    const src =
      "function f() {\n  document.write('<div>' + document.location.hash + '</div>');\n}\n";
    expect(ruleIds(src)).toEqual(["js-dom-xss"]);
  });

  it("carries taint through a template literal", () => {
    const src =
      "function f(el) {\n  const s = location.search;\n  el.innerHTML = `<p>${s}</p>`;\n}\n";
    expect(ruleIds(src)).toEqual(["js-dom-xss"]);
  });

  it("reads insertAdjacentHTML's SECOND argument, not the position", () => {
    const src =
      "function f(el) {\n  el.insertAdjacentHTML('beforeend', document.referrer);\n}\n";
    expect(ruleIds(src)).toEqual(["js-dom-xss"]);
  });

  it("flags eval of an attacker-controlled value", () => {
    expect(ruleIds("function f() {\n  eval(location.hash);\n}\n")).toEqual(["js-eval"]);
  });

  // ---- the negatives that make the rule usable ----

  it("does NOT flag innerHTML from ordinary internal data", () => {
    expect(ruleIds("function f(el, user) {\n  el.innerHTML = user.name;\n}\n")).toEqual([]);
    expect(ruleIds("function f(el) {\n  el.innerHTML = '<b>Loading…</b>';\n}\n")).toEqual([]);
  });

  it("does NOT flag document.write of a constant", () => {
    expect(ruleIds("document.write('<p>hello</p>');\n")).toEqual([]);
  });

  it("does NOT flag textContent — it does not parse HTML", () => {
    expect(
      ruleIds("function f(el) {\n  el.textContent = location.hash;\n}\n")
    ).toEqual([]);
  });

  it("stops at a sanitiser", () => {
    expect(
      ruleIds("function f(el) {\n  el.innerHTML = encodeURIComponent(location.hash);\n}\n")
    ).toEqual([]);
    expect(
      ruleIds("function f(el) {\n  el.innerHTML = DOMPurify.sanitize(location.hash);\n}\n")
    ).toEqual([]);
  });

  it("records the DOM source as evidence", () => {
    const [s] = sinksIn("function f(el) {\n  el.innerHTML = location.search;\n}\n");
    expect(s.taint?.source).toContain("location.search");
    expect(s.severity).toBe("high");
  });

  it("leaves sinks unset for a clean file", () => {
    expect(sinksIn("export function add(a, b) {\n  return a + b;\n}\n")).toEqual([]);
  });
});

describe("rebinding a name to an untainted value ends its flow", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  const ids = (content: string) => {
    const file: SourceFile = { rel: "app.js", ext: "js", content };
    return (parseFile(javascriptPlugin, file, makeIndex([file])).sinks ?? []).map(
      (s) => s.ruleId,
    );
  };

  // Same bug as the Python plugin's: DOMPurify is in JS_SANITIZERS, so the flow
  // is cut — but taint was only added, never removed, so innerHTML below was
  // reported as js-dom-xss. The fix flagged as the bug.
  it("sanitising in place is not a finding", () => {
    expect(
      ids(
        "function render(el) {\n" +
          "  let v = location.hash;\n" +
          "  v = DOMPurify.sanitize(v);\n" +
          "  el.innerHTML = v;\n" +
          "}\n",
      ),
    ).toEqual([]);
  });

  it("an unsanitised flow is still reported", () => {
    expect(
      ids(
        "function render(el) {\n" +
          "  let v = location.hash;\n" +
          "  el.innerHTML = v;\n" +
          "}\n",
      ),
    ).toEqual(["js-dom-xss"]);
  });

  it("a CONDITIONAL sanitise does not untaint the code after it", () => {
    // Deliberate: the walk has no control-flow graph, so clearing inside a
    // branch could hide a real finding on the other path.
    expect(
      ids(
        "function render(el, trusted) {\n" +
          "  let v = location.hash;\n" +
          "  if (trusted) { v = DOMPurify.sanitize(v); }\n" +
          "  el.innerHTML = v;\n" +
          "}\n",
      ),
    ).toEqual(["js-dom-xss"]);
  });
});
