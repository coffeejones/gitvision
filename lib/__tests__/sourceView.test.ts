import { describe, it, expect } from "vitest";
import {
  fetchFileSource,
  isAligned,
  extOf,
  MAX_SOURCE_BYTES,
  type SourceOctokit,
} from "../sourceView";
import { djb2 } from "../codeAnalysis/fileUniverse";

/** Build a fake Octokit whose getContent returns (or throws) whatever the test
 *  supplies — the only surface fetchFileSource touches. */
function octoReturning(data: unknown): SourceOctokit {
  return { rest: { repos: { getContent: async () => ({ data }) } } };
}
function octoThrowing(err: unknown): SourceOctokit {
  return {
    rest: {
      repos: {
        getContent: async () => {
          throw err;
        },
      },
    },
  };
}
/** A GitHub Contents "file" payload for the given source. */
function fileData(content: string, over?: Partial<{ size: number; encoding: string; type: string }>) {
  return {
    type: over?.type ?? "file",
    encoding: over?.encoding ?? "base64",
    size: over?.size ?? Buffer.byteLength(content, "utf-8"),
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
}

const ARGS = { owner: "o", repo: "r", path: "src/a/Foo.ts", ref: "abc123" };

describe("extOf", () => {
  it("returns the lowercased extension", () => {
    expect(extOf("src/a/Foo.TS")).toBe("ts");
    expect(extOf("a/b/c.tsx")).toBe("tsx");
    expect(extOf("Makefile")).toBe("");
    expect(extOf("a/.gitignore")).toBe(""); // leading dot = not an extension
    expect(extOf("x/y.min.js")).toBe("js");
  });
});

describe("isAligned", () => {
  it("is true only when the content hashes to the stored fingerprint", () => {
    const src = "export const x = 1;\n";
    expect(isAligned(src, djb2(src))).toBe(true);
    expect(isAligned(src, djb2("something else"))).toBe(false);
    expect(isAligned(src + " ", djb2(src))).toBe(false); // one byte off
  });
});

describe("fetchFileSource", () => {
  it("decodes a base64 file payload to UTF-8", async () => {
    const src = "function f() {\n  return 42;\n}\n";
    const r = await fetchFileSource(octoReturning(fileData(src)), ARGS);
    expect(r).toEqual({ ok: true, content: src, ext: "ts", bytes: Buffer.byteLength(src) });
  });

  it("rejects a directory (array payload) as not-a-file", async () => {
    const r = await fetchFileSource(octoReturning([{ name: "a" }, { name: "b" }]), ARGS);
    expect(r).toEqual({ ok: false, error: "not-a-file" });
  });

  it("rejects a submodule/symlink (type !== file)", async () => {
    const r = await fetchFileSource(octoReturning(fileData("x", { type: "submodule" })), ARGS);
    expect(r).toEqual({ ok: false, error: "not-a-file" });
  });

  it("rejects a file above the size cap", async () => {
    const r = await fetchFileSource(
      octoReturning(fileData("x", { size: MAX_SOURCE_BYTES + 1 })),
      ARGS,
    );
    expect(r).toEqual({ ok: false, error: "too-large" });
  });

  it("treats the >1MB empty-content / encoding:none response as too-large", async () => {
    const r = await fetchFileSource(
      octoReturning({ type: "file", encoding: "none", content: "", size: 2_000_000 }),
      ARGS,
    );
    expect(r).toEqual({ ok: false, error: "too-large" });
  });

  it("respects an injected lower maxBytes", async () => {
    const r = await fetchFileSource(octoReturning(fileData("0123456789")), { ...ARGS, maxBytes: 5 });
    expect(r).toEqual({ ok: false, error: "too-large" });
  });

  it("maps a 404 to not-found", async () => {
    const r = await fetchFileSource(octoThrowing({ status: 404 }), ARGS);
    expect(r).toEqual({ ok: false, error: "not-found" });
  });

  it("maps 403 and 429 to forbidden", async () => {
    expect(await fetchFileSource(octoThrowing({ status: 403 }), ARGS)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await fetchFileSource(octoThrowing({ status: 429 }), ARGS)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("propagates an unexpected error (e.g. network)", async () => {
    await expect(fetchFileSource(octoThrowing({ status: 500 }), ARGS)).rejects.toEqual({
      status: 500,
    });
  });
});
