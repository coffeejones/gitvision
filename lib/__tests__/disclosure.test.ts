// Tests for the disclosure layer — the AI-as-translator step for security.
//
// The invariant these guard is the whole thesis (architecture invariant #1):
// the AI never introduces a finding. It cannot, structurally — it is handed one
// finding and produces prose about it — and these tests pin the two seams where
// that could leak: the input it is given, and the output it is trusted with.

import { describe, it, expect } from "vitest";
import {
  buildDisclosureUserContent,
  parseDisclosure,
  findingKeyOf,
} from "../security/disclosure";
import type { ClassifiedSink } from "../security/reachability";

function finding(over: Partial<ClassifiedSink> = {}): ClassifiedSink {
  return {
    filePath: "app/views.py",
    ruleId: "py-pickle-load",
    severity: "high",
    line: 36,
    inFunction: "deserialize_data",
    snippet: "user = pickle.loads(decoded_data)",
    reachability: "reachable",
    path: {
      entry: { filePath: "app/views.py", name: "deserialize_data", declared: true, route: "/deserialize", methods: ["POST"] },
      hops: [{ filePath: "app/views.py", name: "deserialize_data" }],
    },
    taint: { source: "request.form", line: 33, via: "decoded_data" },
    ...over,
  };
}

describe("buildDisclosureUserContent", () => {
  it("carries only facts derived from the finding", () => {
    const content = buildDisclosureUserContent(finding(), "owned");
    // Every ground-truth fact is the finding's own.
    expect(content).toContain("py-pickle-load");
    expect(content).toContain("app/views.py:36");
    expect(content).toContain("pickle.loads(decoded_data)");
    expect(content).toContain("POST /deserialize");
    expect(content).toContain("request.form");
    expect(content).toContain('"ownership": "owned"');
  });

  it("passes the ownership calibration through to the model", () => {
    expect(buildDisclosureUserContent(finding(), "third-party")).toContain(
      '"ownership": "third-party"',
    );
  });

  it("omits path and taint facts a finding does not have", () => {
    const content = buildDisclosureUserContent(
      finding({ reachability: "unknown", path: undefined, taint: undefined }),
      "owned",
    );
    expect(content).not.toContain("callPath");
    expect(content).not.toContain("untrustedInputFlow");
    // ...but still reports the finding itself.
    expect(content).toContain("py-pickle-load");
  });

  it("never fabricates a route or parameter the finding lacks", () => {
    // A finding with no path gives the model nothing to name an entry point
    // with — so the input contains no route string to hallucinate from.
    const content = buildDisclosureUserContent(
      finding({ path: undefined, taint: undefined, reachability: "unknown" }),
      "owned",
    );
    expect(content).not.toContain("/deserialize");
    expect(content).not.toContain("entryPoint");
  });
});

describe("findingKeyOf", () => {
  it("is stable and derived from location + rule, not from any model output", () => {
    expect(findingKeyOf(finding())).toBe("app/views.py:36:py-pickle-load");
  });

  it("distinguishes two sinks on the same line by rule", () => {
    expect(findingKeyOf(finding({ ruleId: "py-eval" }))).not.toBe(
      findingKeyOf(finding({ ruleId: "py-sql-assembled" })),
    );
  });
});

describe("parseDisclosure", () => {
  const valid = JSON.stringify({
    title: "Insecure deserialization",
    howReached: "POST /deserialize reaches pickle.loads via deserialize_data().",
    impact: "Remote code execution.",
    trigger: "A POST to /deserialize whose body carries a crafted pickle payload.",
    fix: "Replace pickle with a safe format such as JSON.",
    disclosure: null,
  });

  it("parses the model's JSON into prose fields", () => {
    const p = parseDisclosure(valid);
    expect(p.title).toBe("Insecure deserialization");
    expect(p.impact).toBe("Remote code execution.");
    expect(p.disclosure).toBeNull();
  });

  it("strips markdown fences the model added despite instructions", () => {
    expect(parseDisclosure("```json\n" + valid + "\n```").title).toBe(
      "Insecure deserialization",
    );
  });

  it("keeps a real disclosure string for third-party reports", () => {
    const p = parseDisclosure(
      JSON.stringify({ title: "x", howReached: "x", impact: "x", trigger: "x", fix: "x", disclosure: "Report privately to the maintainers." }),
    );
    expect(p.disclosure).toBe("Report privately to the maintainers.");
  });

  it("coerces a placeholder disclosure to null", () => {
    for (const junk of ["null", "none", "N/A", ""]) {
      const p = parseDisclosure(
        JSON.stringify({ title: "x", howReached: "x", impact: "x", trigger: "x", fix: "x", disclosure: junk }),
      );
      expect(p.disclosure).toBeNull();
    }
  });

  it("surfaces an unparseable response rather than failing silently", () => {
    const p = parseDisclosure("I cannot help with that.");
    expect(p.impact).toContain("unparseable");
    expect(p.title).toBe("");
  });

  it("ignores extra fields the model invents — only the known shape survives", () => {
    // The structural guard: even if the model tries to emit another "finding",
    // there is nowhere for it to land. Only the fixed prose fields are read.
    const p = parseDisclosure(
      JSON.stringify({
        title: "x",
        howReached: "x",
        impact: "x",
        trigger: "x",
        fix: "x",
        disclosure: null,
        extraFinding: { ruleId: "py-eval", file: "other.py", line: 999 },
        secondVulnerability: "SQL injection in login()",
      }),
    );
    expect(Object.keys(p).sort()).toEqual([
      "disclosure",
      "fix",
      "howReached",
      "impact",
      "title",
      "trigger",
    ]);
  });
});
