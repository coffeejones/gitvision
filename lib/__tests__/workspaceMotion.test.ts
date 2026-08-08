import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "components", "views", "WorkspaceMotion.tsx"),
  "utf8",
);

describe("workspace reveal hydration contract", () => {
  it("never mutates React-owned class or style attributes", () => {
    expect(source).not.toMatch(/\.classList\./);
    expect(source).not.toMatch(/\.setAttribute\(/);
    expect(source).not.toMatch(/\.style\.[a-zA-Z]/);
  });

  it("uses cancellable presentation-only animations", () => {
    expect(source).toContain(".animate(");
    expect(source).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(source).toContain("observer.disconnect()");
    expect(source).toContain(".cancel()");
  });
});
