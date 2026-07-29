// Every page under the session layout must read through getSessionCached.
//
// This is not style. getSession is fs.readFile + JSON.parse of the whole
// session file, and React's cache() memoizes per WRAPPED FUNCTION IDENTITY —
// so a page importing the raw getSession gets a different memo cell from the
// layout's getSessionCached, and the file is read and parsed twice per request.
// Sixteen pages did that. Nothing failed, nothing logged, and the layout's own
// comment asserted the opposite ("Next.js dedupes within a request", which is
// true of fetch and not of readFile).
//
// Measured on the 55 MB zod session before this guard existed: /prs 292ms
// median, 209ms once it used the cached read. The cost scales with the session
// file, so it is worst exactly where it hurts most.
//
// The two route handlers are exempt on purpose: they render no React tree, so
// cache() has nothing to dedup across.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const SESSION_DIR = path.join(process.cwd(), "app", "session", "[id]");
const read = (p: string) => readFileSync(p, "utf-8");

/** Every page.tsx rendered inside app/session/[id]/layout.tsx. */
function layoutWrappedPages(): { name: string; src: string }[] {
  const out: { name: string; src: string }[] = [];
  const root = path.join(SESSION_DIR, "page.tsx");
  if (existsSync(root)) out.push({ name: "page.tsx", src: read(root) });
  for (const entry of readdirSync(SESSION_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(SESSION_DIR, entry.name, "page.tsx");
    if (existsSync(p)) out.push({ name: `${entry.name}/page.tsx`, src: read(p) });
  }
  return out;
}

describe("session pages read through the request-scoped cache", () => {
  const pages = layoutWrappedPages();

  it("finds the pages at all", () => {
    // A rename that emptied this list would turn every assertion below into a
    // vacuous pass.
    expect(pages.length).toBeGreaterThan(10);
  });

  for (const { name, src } of pages) {
    if (!/\bgetSession/.test(src)) continue;

    it(`${name} imports getSessionCached, not the raw read`, () => {
      expect(src).toMatch(
        /import \{[^}]*getSessionCached[^}]*\} from "@\/lib\/sessionCache"/,
      );
      // The raw name must not appear as a call anywhere — including a stray
      // second read, which is how merge/page.tsx (two ids) could regress.
      const rawCalls = [...src.matchAll(/\bgetSession\((?!Cached)/g)];
      expect(rawCalls, `${name} still calls the uncached getSession`).toEqual([]);
    });
  }
});

describe("the cache module is what the pages think it is", () => {
  const cacheSrc = read(path.join(process.cwd(), "lib", "sessionCache.ts"));

  it("wraps getSession in React cache()", () => {
    // If this stopped being cache()-wrapped the guard above would keep passing
    // while the dedup silently stopped happening.
    expect(cacheSrc).toMatch(/import \{ cache \} from "react"/);
    expect(cacheSrc).toMatch(/export const getSessionCached = cache\(getSession\)/);
  });

  it("leaves the raw getSession available for non-React callers", () => {
    // The Watch cron, the MCP server and patchLatestSnapshot must NOT share a
    // memoized object — patchLatestSnapshot mutates what it reads before
    // writing it back.
    const storage = read(path.join(process.cwd(), "lib", "storage.ts"));
    expect(storage).toMatch(/export async function getSession\(/);
    expect(storage).toMatch(/patchLatestSnapshot[\s\S]{0,400}?await getSession\(/);
  });
});

describe("route handlers stay on the raw read", () => {
  it("evidence and sbom are exempt, and deliberately so", () => {
    // They render no React tree, so cache() would be a no-op — but if one of
    // them ever becomes a page, the guard above starts covering it.
    for (const r of ["evidence", "sbom"]) {
      const p = path.join(SESSION_DIR, r, "route.ts");
      if (!existsSync(p)) continue;
      expect(read(p)).toMatch(/getSession/);
      expect(existsSync(path.join(SESSION_DIR, r, "page.tsx"))).toBe(false);
    }
  });
});
