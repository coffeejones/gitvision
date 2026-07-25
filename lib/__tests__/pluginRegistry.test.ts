// Plugin-registry contract.
//
// WHY THIS FILE EXISTS: delete one line from lib/codeAnalysis/plugins/all.ts —
// say `rubyPlugin,` — and before this test every single one of the ~1870 other
// tests still passed, because each language suite imports its plugin object
// directly and never goes through the registry. Meanwhile production
// (lib/github.ts) and simulate (lib/shadowGraph/simulateSession.ts) analyze with
// ALL_PLUGINS, so every Ruby repo would have parsed to 0 functions, 0 calls,
// 0 imports.
//
// That failure mode is worse than a crash. Nothing downstream treats it as an
// error: the coverage panel reports every function untested, the verdict scores
// that, blast radius and Flows come back empty, and languageSupport still claims
// Ruby IS parsed — so the honest "this language isn't parsed yet" empty state
// never fires. The product would confidently say the wrong thing.
//
// These assertions are deliberately literal. A plugin genuinely being added or
// removed SHOULD fail here and be updated by hand — that is the point.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALL_PLUGINS } from "../codeAnalysis/plugins/all";
import { isParsedLanguage } from "../codeAnalysis/languageSupport";

/** The registry as production expects it. Order matters: analyze.ts builds its
 *  extension map by iterating this list, so a later plugin claiming the same
 *  extension silently wins. */
const EXPECTED_PLUGINS = [
  "javascript",
  "python",
  "go",
  "java",
  "csharp",
  "php",
  "ruby",
  "regex-fallback",
] as const;

/** Every extension the pipeline must keep handling. */
const EXPECTED_EXTENSIONS = [
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", // javascript
  "py", "go", "java", "cs", "php", "rb",                 // one AST plugin each
  "kt", "html", "css",                                    // regex fallback
];

describe("plugin registry — the set production actually analyzes with", () => {
  it("contains exactly the expected plugins, in order", () => {
    expect(ALL_PLUGINS.map((p) => p.name)).toEqual([...EXPECTED_PLUGINS]);
  });

  it("has no two plugins claiming the same extension", () => {
    // analyze.ts:74-77 does `pluginByExt.set(ext, p)` in list order, so a
    // collision is a silent last-wins override, not an error.
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const p of ALL_PLUGINS) {
      for (const ext of p.extensions) {
        const prev = owner.get(ext);
        if (prev) collisions.push(`.${ext}: ${prev} overridden by ${p.name}`);
        owner.set(ext, p.name);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("covers every extension the pipeline is expected to handle", () => {
    const covered = new Set(ALL_PLUGINS.flatMap((p) => [...p.extensions]));
    expect(EXPECTED_EXTENSIONS.filter((e) => !covered.has(e))).toEqual([]);
  });

  it("gives every plugin a parsing path the orchestrator can dispatch to", () => {
    // parse.ts:61 prefers parseDirect and falls back to languageFor+queriesFor;
    // a plugin with neither throws at parse time (parse.ts:72-76) — per FILE,
    // so it surfaces as a parse error on real repos rather than at startup.
    //
    // Note the real shape here, which differs from what AGENTS.md describes:
    // all eight plugins define parseDirect (the AST plugins run their own
    // tree-sitter walk inside it), so the query path is currently never taken.
    // The assertion is therefore "at least one usable path", not "exactly one".
    for (const p of ALL_PLUGINS) {
      const usable =
        typeof p.parseDirect === "function" ||
        (typeof p.languageFor === "function" && typeof p.queriesFor === "function");
      expect(usable, `${p.name} has no usable parsing path`).toBe(true);
    }
  });

  it("keeps languageSupport in lockstep — no plugin without a claim, no claim without a plugin", () => {
    // If these drift, the UI lies in one of two directions: it promises parsing
    // for a language nothing handles, or it shows "not parsed yet" for one we do.
    const claimed = ["JavaScript", "TypeScript", "Python", "Go", "Java", "C#", "PHP", "Ruby"];
    for (const name of claimed) {
      expect(isParsedLanguage(name), `${name} is claimed as parsed`).toBe(true);
    }
    // Kotlin is deliberately absent: regexFallback reads its imports, not its
    // functions, so claiming it would overstate what we can show.
    expect(isParsedLanguage("Kotlin")).toBe(false);
    // Every AST plugin (all but the fallback) must back one of those claims.
    expect(ALL_PLUGINS.filter((p) => p.name !== "regex-fallback")).toHaveLength(claimed.length - 1);
  });
});

describe("plugin registry — no second copy of the list", () => {
  // all.ts's own header says centralizing exists so a service copy can't drift.
  // Two copies had drifted anyway (cli.ts and the debug API route each inlined
  // their own eight-plugin array), which is exactly how the byte-identical
  // simulate contract breaks quietly. This guard is the enforcement that the
  // header assumed. Same shape as the determinism guard.
  it("has no file building its own plugin array instead of importing ALL_PLUGINS", () => {
    const ROOT = join(__dirname, "..", "..");
    const SKIP = new Set(["node_modules", ".next", ".git", ".gitvision", "__tests__", "dist", "pkg"]);
    const ALLOWED = join("lib", "codeAnalysis", "plugins", "all.ts");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry) || entry.startsWith(".")) continue;
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        const rel = p.slice(ROOT.length + 1);
        if (rel === ALLOWED) continue;
        const src = readFileSync(p, "utf8");
        // A file naming three or more plugin objects is assembling its own set.
        const named = ["javascriptPlugin", "pythonPlugin", "goPlugin", "javaPlugin",
          "csharpPlugin", "phpPlugin", "rubyPlugin", "regexFallbackPlugin"]
          .filter((n) => src.includes(n)).length;
        if (named >= 3) offenders.push(rel);
      }
    };
    walk(join(ROOT, "lib"));
    walk(join(ROOT, "app"));
    walk(join(ROOT, "mcp"));

    expect(
      offenders,
      `these build their own plugin list — import ALL_PLUGINS from lib/codeAnalysis/plugins/all instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
