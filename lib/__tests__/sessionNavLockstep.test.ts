// The sidebar and the command palette are two hand-written lists of the same
// thing, and they drifted.
//
// Faultline and Source shipped with sidebar entries and a "new" badge, and
// were never added to the palette — so for anyone who navigates by Cmd+K they
// did not exist. The palette's own header said "all 10 tabs" while it held 14
// and Forensics had grown from 4 entries to 9. Nothing failed; a tab is just
// added to one list and not the other, and nobody notices until they reach for
// it.
//
// Deriving both from one exported list would prevent this by construction, but
// the sidebar's array is built inside an 800-line client component with
// per-item JSX icons, badges and hints — a refactor with more risk than the
// bug. This test buys the same guarantee at the cost of parsing two files.
//
// It reads SOURCE, not a rendered tree: vitest runs in node here and neither
// component can mount. That is a real limit — it checks that the lists agree,
// not that either one renders. It cannot catch an entry that exists but is
// broken; it can only catch one that is missing.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "app", "session", "[id]");

const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8");

/** Route folders under app/session/[id]/ that render a page. `evidence` and
 *  `sbom` hold only a route.ts — they are file downloads (the evidence pack and
 *  the SBOM), linked from inside SbomPanel, and render no React tree. They
 *  belong in neither list. */
function routeSlugsWithPages(): string[] {
  return readdirSync(ROUTES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((d) => readdirSync(path.join(ROUTES_DIR, d.name)).includes("page.tsx"))
    .map((d) => d.name)
    .sort();
}

/** Slugs the palette can reach. Entries are `id: "p:<slug>"`, with the overview
 *  keyed `p:overview` against `href: base`. */
function paletteSlugs(): string[] {
  const src = read("components", "CommandPalette.tsx");
  return [...src.matchAll(/id: "p:([a-z]+)"/g)].map((m) => m[1]).sort();
}

/** Slugs the sidebar links to: every href in the `departments` array, plus the
 *  Final grade pin, which VerdictPin renders separately (outside `departments`,
 *  bottom-pinned) and is therefore easy to forget. */
function sidebarSlugs(): string[] {
  const src = read("components", "SessionShell.tsx");
  const start = src.indexOf("const departments: Department[] = [");
  expect(start, "the sidebar's departments array moved or was renamed").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("\n  ];", start));

  const slugs = [...block.matchAll(/href: `\$\{base\}\/([a-z]+)`/g)].map((m) => m[1]);
  if (/href: base,/.test(block)) slugs.push("overview");

  // Nested destinations live OUTSIDE the departments array — the brief sits
  // above them because it is a question, not a department. They are matched
  // separately and on their FIRST segment, which is the palette's key too.
  // Without this the test would pass while a nav entry was unreachable by
  // Cmd+K, which is the exact drift it exists to catch.
  for (const m of src.matchAll(/href=\{`\$\{base\}\/([a-z]+)\/[a-z]+`\}/g)) {
    slugs.push(m[1]);
  }

  const pin = src.match(/const href = `\$\{base\}\/([a-z]+)`/);
  expect(pin, "the Final grade pin's href moved — it would silently drop out").not.toBeNull();
  slugs.push(pin![1]);

  return slugs.sort();
}

describe("the sidebar and the palette stay in lockstep", () => {
  it("makes every sidebar destination reachable by Cmd+K", () => {
    // The actual bug. Faultline and Source failed here.
    const missing = sidebarSlugs().filter((s) => !paletteSlugs().includes(s));
    expect(
      missing,
      "in the sidebar but not the palette — add an entry to components/CommandPalette.tsx",
    ).toEqual([]);
  });

  it("does not offer a palette entry the sidebar has dropped", () => {
    // The other direction: a page is retired from the sidebar and the palette
    // keeps sending people to it.
    const orphans = paletteSlugs().filter((s) => !sidebarSlugs().includes(s));
    expect(
      orphans,
      "in the palette but not the sidebar — stale entry, or a missing sidebar row",
    ).toEqual([]);
  });

  it("points both lists at routes that exist", () => {
    const routes = [...routeSlugsWithPages(), "overview"];
    // `merge` is a real page but not a nav destination: it is PR-scoped, needs
    // session.prMetadata.baseSessionId, and is entered from the PR-bot check-run
    // deep link. Absent from both lists on purpose, so it is not required here —
    // this assertion only runs the other way.
    // A nested route (brief/[subject]) has no page.tsx directly under its own
    // folder, so accept either shape rather than pretending it does not exist.
    const nested = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((d) =>
        readdirSync(path.join(ROUTES_DIR, d.name), { withFileTypes: true }).some(
          (c) => c.isDirectory() && readdirSync(path.join(ROUTES_DIR, d.name, c.name)).includes("page.tsx"),
        ),
      )
      .map((d) => d.name);
    for (const slug of new Set([...sidebarSlugs(), ...paletteSlugs()])) {
      expect(
        [...routes, ...nested],
        `nav points at /${slug}, which has no page.tsx`,
      ).toContain(slug);
    }
  });

  it("would have caught the drift it was written for", () => {
    // The guard is only worth its runtime if it fails on the state that
    // prompted it: the palette as it shipped, without Faultline or Source.
    const shipped = paletteSlugs().filter((s) => s !== "faultline" && s !== "source");
    const missing = sidebarSlugs().filter((s) => !shipped.includes(s));
    expect(missing).toEqual(["faultline", "source"]);
  });
});
