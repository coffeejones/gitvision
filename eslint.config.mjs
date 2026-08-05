import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// SCOPE FIRST, RULES SECOND.
//
// A bare `npx eslint .` reported 48,314 problems (7,881 errors) — and 96.5% of
// them were not this project's code:
//
//   .claude/worktrees/**        46,612   git worktrees: whole extra checkouts
//   mcp/pkg/**                     657   the generated esbuild bundle (gitignored)
//   scripts/benchmark/.work/**     ~150   benchmark repos cloned at run time
//
// That is why CI never gained a lint step: the number was too large to act on
// and too meaningless to triage. Scoping it to the code we actually write makes
// the remainder a baseline rather than a wall.
//
// bench/ IS linted. It is tracked, hand-written, and it is the harness the
// security claims rest on.

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Git worktrees. `git worktree add .claude/worktrees/x` puts a COMPLETE
    // second checkout inside the repo, so every source file is linted twice —
    // and the copies are usually mid-edit, so they report problems that do not
    // exist on this branch and cannot be fixed from it.
    ".claude/worktrees/**",

    // Build output of the MCP package — both the tsc emit (mcp/dist) and the
    // bundled esbuild artefact (mcp/pkg). Both gitignored, both compiled from
    // the .ts sources that ARE linted. The 254 no-require-imports errors were
    // all in mcp/dist: complaining that compiled CommonJS uses require().
    "mcp/dist/**",
    "mcp/pkg/**",

    // Repositories the benchmark clones at run time to measure against.
    // Third-party source that happens to live under our tree.
    "**/.work/**",
  ]),

  // DEFERRED, NOT DISMISSED. eslint-plugin-react-hooks 7 promoted this to an
  // error: 35 hits across 20 components. It warns that a synchronous setState
  // inside an effect can cascade renders — a performance hint, not a
  // correctness one, and the hits are a codebase-wide pattern rather than a
  // localised mistake. Rewriting twenty working components to turn CI green
  // would be the tail wagging the dog.
  //
  // Kept visible as a warning so the count is honest and shrinkable, and so CI
  // can gate on errors TODAY instead of waiting for a refactor that may never
  // be worth doing. If it ever causes a measured jank, fix the file and let the
  // count fall.
  {
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },

  // bench/ reads benchmark JSON that has no schema — the `any` is the honest
  // type there, and inventing interfaces for a research harness would be
  // fiction. Warned rather than silenced so it stays countable.
  {
    files: ["bench/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
]);

export default eslintConfig;
