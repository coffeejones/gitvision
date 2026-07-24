# codetrawl-mcp

MCP server that exposes the CodeTrawl code-analysis pipeline as
Model Context Protocol tools — so AI coding agents (Claude Code,
Cursor, Cline, Aider, anything that speaks MCP) can query
deterministic structural information about a GitHub repo without
hallucinating cross-file relationships.

The point isn't raw graph access — it's **verdicts, not queries**:
ranked blast radius, untested hotspots, change-review suggestions.
Give an agent this before it decides *what to touch*, and it plans
with the cross-file consequences in view instead of guessing from
the three files it grepped.

## What it answers

When an agent asks "what calls this function?" / "what breaks if
I edit this file?" / "is there already a similar pattern in this
codebase?", today it grep-greps and guesses. With this server
connected, it gets actual answers from a tree-sitter AST + call
graph — no LLM in the analysis path.

Eight tools are exposed. Each takes JSON in, returns JSON out, and
runs in milliseconds against a cached snapshot.

| Tool | Purpose |
|---|---|
| `analyze_repo` | Download + parse a GitHub repo, return a stable session id and a compact summary. Always call this first. |
| `blast_radius` | What breaks if you change a file or function. Cross-file reach via imports + call graph, capped at 3 hops. |
| `untested_hotspots` | Production functions with no direct test caller, ranked by complexity. |
| `find_duplicates` | Functions with identical structural shape (FNV-1a AST hash) across the codebase. Refactor candidates. |
| `signals` | Deterministic health verdict — what works, what needs work, what needs human judgment. Plus a dimension rollup. |
| `compare_sessions` | High-level diff of two analyses of the same repo (top-N lists, dup + coverage deltas). Verify a refactor moved the needle. |
| `analyze_diff` | Function-level diff between two snapshots — every changed function classified add/remove/modify, with complexity delta + a bodyChanged flag. PR-comment-grade detail. |
| `review_changes` | Prioritized verification suggestions on top of a diff ("addPet complexity rose +7 without tests"), each with severity + evidence. PR-bot / reviewer hints. |

## Install

Once `codetrawl-mcp` is published to npm, wiring it is one line:

```sh
claude mcp add codetrawl npx codetrawl-mcp
```

### Publishing the package (maintainer)

The standalone package is a build artifact — `npm run mcp:pack` esbuild-bundles
the stdio server (externalizing only the tree-sitter WASM deps) into
`mcp/pkg/`, with a `package.json` whose deps are pinned from the root so it can
never drift from what the app analyzes with. Verify it actually runs when
installed, then publish:

```sh
npm run mcp:pack:test    # pack → install the tarball in a temp dir → boot it
                         # as an MCP server → analyze a repo (proves WASM resolves)
cd mcp/pkg && npm publish
```

### From source (development)

```sh
git clone https://github.com/coffeejones/gitvision.git
cd gitvision && npm install && npm run mcp:build
npm run mcp:validate     # typecheck + the MCP-layer test suite
```

The built entry lives at `mcp/dist/mcp/server.js`.

## Wire it to your MCP client

### Claude Code (current install path)

```sh
claude mcp add codetrawl node /absolute/path/to/gitvision/mcp/dist/mcp/server.js
```

Once `codetrawl-mcp` is published to npm, this will become:

```sh
claude mcp add codetrawl npx codetrawl-mcp
```

### Cursor / Cline / others

Most MCP clients accept a JSON config of the same shape. Example:

```json
{
  "mcpServers": {
    "codetrawl": {
      "command": "node",
      "args": ["/absolute/path/to/gitvision/mcp/dist/mcp/server.js"]
    }
  }
}
```

### Pre-flight recipe (make the agent actually use it)

Agents that grep don't call tools they don't know they need. Drop this
into your project's `AGENTS.md` / `CLAUDE.md` so the agent reaches for
CodeTrawl *before* it edits load-bearing code:

```md
## Before changing a file, check its blast radius

This repo is connected to the CodeTrawl MCP server. Before you edit a
file that other code depends on:
1. Call `analyze_repo` once with the repo URL to get a session id.
2. Call `blast_radius` on the file/function you're about to change —
   read the dependents and how many are untested before you commit to
   the edit.
3. Call `untested_hotspots` if you're adding behavior, so you test the
   riskiest paths first.
Treat the results as pre-planning context (repo-at-commit), not a
live view of your unsaved edits.
```

### GitHub authentication (optional but recommended)

Without auth, GitHub's public API throttles you to 60 requests/hour
— enough for a few analyses, then you'll get rate-limited. Set
`GITHUB_TOKEN` in the environment your MCP client launches the
server from to lift the limit to 5,000/hr:

```sh
export GITHUB_TOKEN=ghp_yourPersonalAccessToken
```

The token only needs the `public_repo` scope. Private-repo access
isn't supported yet — coming later.

## Usage

In a chat with a connected agent:

> "Use codetrawl to analyze https://github.com/vercel/next.js,
> then tell me which functions have the largest blast radius."

The agent will call `analyze_repo` first (returns sessionId), then
`blast_radius` on the files / functions it identifies as
interesting from the summary.

Subsequent calls within 10 minutes (in-memory) or 24 hours
(on-disk) on the same repo URL hit the cache — no re-download, no
re-parse.

## Cache

Two layers:

- **In-memory** — hot path, 10-minute TTL, 8 entries max (FIFO).
- **On-disk** — `~/.gitvision/cache/{sessionId}.json`, 24-hour TTL,
  survives MCP server restarts.

Disk cache is automatic. To clear it, just delete the directory:

```sh
rm -rf ~/.gitvision/cache
```

## Language support

Tree-sitter AST coverage today: JavaScript, TypeScript, JSX, TSX
(via the JS plugin), Python, Go, Java, C#, PHP, Ruby. Other
languages fall back to a regex-based import parser — they show up
in `analyze_repo`'s summary but won't appear in `blast_radius` or
`find_duplicates` (those need the call graph).

## Privacy

The MCP server runs as a child process of your MCP client. Repo
analysis happens on your machine. No CodeTrawl-controlled server
sees the repos you analyze. Cache stays in `~/.gitvision/cache` on
your filesystem.

## License

PolyForm Noncommercial 1.0.0 — free for personal, learning, and
nonprofit use. Contact [coffeejones](https://github.com/coffeejones)
for commercial licensing.
