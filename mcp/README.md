# repojury-mcp

MCP server that exposes the RepoJury code-analysis pipeline as
Model Context Protocol tools — so AI coding agents (Claude Code,
Cursor, Cline, Aider, anything that speaks MCP) can query
deterministic structural information about a GitHub repo without
hallucinating cross-file relationships.

## What it answers

When an agent asks "what calls this function?" / "what breaks if
I edit this file?" / "is there already a similar pattern in this
codebase?", today it grep-greps and guesses. With this server
connected, it gets actual answers from a tree-sitter AST + call
graph — no LLM in the analysis path.

Six tools are exposed. Each takes JSON in, returns JSON out, and
runs in milliseconds against a cached snapshot.

| Tool | Purpose |
|---|---|
| `analyze_repo` | Download + parse a GitHub repo, return a stable session id and a compact summary. Always call this first. |
| `blast_radius` | What breaks if you change a file or function. Cross-file reach via imports + call graph, capped at 3 hops. |
| `find_duplicates` | Functions with identical structural shape (FNV-1a AST hash) across the codebase. Refactor candidates. |
| `untested_hotspots` | Production functions with no direct test caller, ranked by complexity. |
| `signals` | 17-signal health verdict — what works, what needs work, what needs human judgment. Plus a 6-dimension rollup. |
| `compare_sessions` | Diff two analyses of the same repo. Verify a refactor moved the needle: analyze before, apply, analyze after, then compare. |

## Install

> **Status:** v0.66 (C1.3). Pre-npm-publish — install from source.
> A standalone npm package (`repojury-mcp`) will follow once we
> have a few external integrations validating the surface.

Clone the RepoJury repo and build locally:

```sh
git clone https://github.com/coffeejones/repobaron.git
cd repobaron
npm install
npm run mcp:build
```

The built entry lives at `mcp/dist/mcp/server.js`.

To validate the build before wiring it to a client (recommended):

```sh
npm run mcp:validate     # build + run the MCP-layer test suite
```

## Wire it to your MCP client

### Claude Code (current install path)

```sh
claude mcp add repojury node /absolute/path/to/repobaron/mcp/dist/mcp/server.js
```

Once `repojury-mcp` is published to npm, this will become:

```sh
claude mcp add repojury npx repojury-mcp
```

### Cursor / Cline / others

Most MCP clients accept a JSON config of the same shape. Example:

```json
{
  "mcpServers": {
    "repojury": {
      "command": "node",
      "args": ["/absolute/path/to/repobaron/mcp/dist/mcp/server.js"]
    }
  }
}
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
isn't supported in v0.65 — coming later.

## Usage

In a chat with a connected agent:

> "Use repobaron to analyze https://github.com/vercel/next.js,
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
analysis happens on your machine. No RepoJury-controlled server
sees the repos you analyze. Cache stays in `~/.gitvision/cache` on
your filesystem.

## License

PolyForm Noncommercial 1.0.0 — free for personal, learning, and
nonprofit use. Contact [coffeejones](https://github.com/coffeejones)
for commercial licensing.
