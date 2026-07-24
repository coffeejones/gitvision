#!/usr/bin/env node
// Build the standalone `codetrawl-mcp` npm package.
//
// esbuild-bundles the stdio MCP server (mcp/standalone.ts + its 87-module
// closure) into ONE CommonJS file, externalizing only the WASM-carrying deps —
// web-tree-sitter (Emscripten glue that can't be bundled, the same failure
// Turbopack hits) and @vscode/tree-sitter-wasm (21 MB of pure-data grammars).
// Everything else (octokit, zod, nanoid, tar, …) is inlined, so npm never
// installs the 25-package octokit tree and the type-only-reachable Anthropic SDK
// is tree-shaken out entirely.
//
// The output is a build ARTIFACT under mcp/pkg/ (git-ignored) with a generated
// package.json whose deps are pinned from the ROOT package.json — no hand-
// maintained version that can drift from what the app actually analyzes with.

import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "mcp", "pkg");
const PKG_VERSION = "0.2.0"; // the npm package version — bump on each publish

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
function pin(name) {
  const v = rootPkg.dependencies?.[name];
  if (!v) throw new Error(`root package.json has no dependency "${name}"`);
  return v;
}

// The codebase writes `import "./foo.js"` that resolves to ./foo.ts on disk
// (TS-ESM convention). esbuild doesn't do that swap by default, so teach it.
const tsExtResolve = {
  name: "ts-js-ext-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.path.startsWith(".")) return;
      const abs = path.resolve(args.resolveDir, args.path);
      for (const ext of [".ts", ".tsx"]) {
        const candidate = abs.replace(/\.js$/, ext);
        if (fs.existsSync(candidate)) return { path: candidate };
      }
      return; // fall through to esbuild's own resolution
    });
  },
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "bin"), { recursive: true });

const bin = path.join(OUT, "bin", "codetrawl-mcp.cjs");
await esbuild.build({
  entryPoints: [path.join(ROOT, "mcp", "standalone.ts")],
  outfile: bin,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["web-tree-sitter", "@vscode/tree-sitter-wasm"],
  plugins: [tsExtResolve],
  logLevel: "warning",
});
// esbuild preserves the entry's shebang; make sure the bin is executable.
fs.chmodSync(bin, 0o755);

const pkg = {
  name: "codetrawl-mcp",
  version: PKG_VERSION,
  description:
    "CodeTrawl's deterministic code analysis as MCP tools for AI agents — blast radius, untested hotspots, structural duplicates, health signals, and change simulation on any GitHub repo. Computed, never guessed.",
  type: "commonjs",
  bin: { "codetrawl-mcp": "bin/codetrawl-mcp.cjs" },
  files: ["bin", "README.md", "LICENSE"],
  engines: { node: ">=20.9" },
  // Only the WASM carriers are runtime deps; the rest is bundled.
  dependencies: {
    "web-tree-sitter": pin("web-tree-sitter"),
    "@vscode/tree-sitter-wasm": pin("@vscode/tree-sitter-wasm"),
  },
  license: "PolyForm-Noncommercial-1.0.0",
  repository: {
    type: "git",
    url: "git+https://github.com/coffeejones/gitvision.git",
    directory: "mcp",
  },
  homepage: "https://codetrawl.com",
  keywords: [
    "mcp",
    "model-context-protocol",
    "code-analysis",
    "static-analysis",
    "tree-sitter",
    "ai-agents",
    "blast-radius",
  ],
};
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

fs.writeFileSync(path.join(OUT, "README.md"), packageReadme());
const licenseSrc = path.join(ROOT, "LICENSE");
fs.writeFileSync(
  path.join(OUT, "LICENSE"),
  fs.existsSync(licenseSrc)
    ? fs.readFileSync(licenseSrc, "utf8")
    : "PolyForm Noncommercial License 1.0.0 — https://polyformproject.org/licenses/noncommercial/1.0.0/\n",
);

const kb = Math.round(fs.statSync(bin).size / 1024);
console.log(`\n  ✓ codetrawl-mcp@${PKG_VERSION} built → ${path.relative(ROOT, OUT)}`);
console.log(`    bundle ${kb} KB · runtime deps: web-tree-sitter + @vscode/tree-sitter-wasm`);
console.log(`    test:    npm run mcp:pack:test`);
console.log(`    publish: (cd mcp/pkg && npm publish)\n`);

function packageReadme() {
  return `# codetrawl-mcp

Deterministic code analysis as [Model Context Protocol](https://modelcontextprotocol.io)
tools, so AI coding agents can ask **computed** questions about a GitHub repo —
blast radius, untested hotspots, structural duplicates, a 17-signal health
verdict, and "what does this change break?" simulation — instead of grepping and
guessing.

Powered by [CodeTrawl](https://codetrawl.com). Transport is stdio; the server
runs as a child process of your MCP client and analyzes public repos on demand
(no data leaves your machine except the repo fetch from GitHub).

## Install

\`\`\`sh
claude mcp add codetrawl npx codetrawl-mcp
\`\`\`

Or globally, then point any MCP client at the \`codetrawl-mcp\` binary:

\`\`\`sh
npm install -g codetrawl-mcp
\`\`\`

**GitHub token (recommended):** analysis fetches the repo from GitHub. Set
\`GITHUB_TOKEN\` in the server's environment to lift the 60-request/hour
unauthenticated limit to 5000/hour.

## Tools

- \`analyze_repo\` — entry point; returns a sessionId every other tool needs
- \`blast_radius\` — what a file or function change reaches
- \`untested_hotspots\` — complex production functions with no test caller
- \`find_duplicates\` — structurally identical functions across the repo
- \`signals\` — the full 17-signal health verdict + dimension rollup
- \`compare_sessions\` — structural diff between two analyses
- \`analyze_diff\` / \`review_changes\` — change-aware review
- \`simulate_change\` — the Conscience: the deterministic blast + gate on a
  proposed diff, before you commit it

Plus the \`conscience\` prompt — the agent loop that runs \`simulate_change\` and
respects its gate.

## License

PolyForm Noncommercial 1.0.0 — free for noncommercial use. For commercial use,
contact [coffeejones](https://github.com/coffeejones).
`;
}
