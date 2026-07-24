// The two conditions under test, each as a tool provider:
//   - codetrawlProvider: bridges the published codetrawl-mcp stdio server —
//     its 9 tools become Anthropic tool defs, calls proxy through to the server.
//   - fileProvider: a realistic, capable repo-exploration toolset (list/read/
//     grep) over a local clone — the baseline a normal coding agent has. NOT
//     crippled: grep + read is exactly what an agent greps a repo with.
//
// A provider is { label, tools, execute(name,input)->string, close() }.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cap = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated at ${n} chars]` : s);

// ---- Condition A: CodeTrawl MCP ----------------------------------------

export async function codetrawlProvider({ env }) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "codetrawl-mcp@0.1.0"],
    env,
  });
  const client = new Client({ name: "benchmark", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    label: "codetrawl-mcp",
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema,
    })),
    async execute(name, input) {
      const res = await client.callTool({ name, arguments: input });
      const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
      return cap(res.isError ? `ERROR: ${text}` : text, 60000);
    },
    close: () => client.close(),
  };
}

// ---- Condition B: grep + read over a local clone -----------------------

export function fileProvider(root) {
  const safe = (p) => {
    const abs = path.resolve(root, p ?? ".");
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes repo root: ${p}`);
    return abs;
  };

  const tools = [
    {
      name: "list_dir",
      description:
        "List the files and subdirectories of a directory in the repository. Input: {path} relative to the repo root ('.' for the root).",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: [] },
    },
    {
      name: "read_file",
      description:
        "Read a text file from the repository. Input: {path} relative to the repo root; optional {start_line,end_line} (1-indexed, inclusive) to read only a slice of a large file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
        },
        required: ["path"],
      },
    },
    {
      name: "grep",
      description:
        "Search the repository for a regular-expression pattern. Returns matching lines as file:line:text. Input: {pattern}; optional {path} to scope the search to a subtree/file; optional {glob} like '*.js' to restrict by filename.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  ];

  async function execute(name, input) {
    if (name === "list_dir") {
      const dir = safe(input.path ?? ".");
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return (
        entries
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
          .sort()
          .join("\n") || "[empty directory]"
      );
    }
    if (name === "read_file") {
      const f = safe(input.path);
      const stat = fs.statSync(f);
      if (stat.isDirectory()) return `[${input.path} is a directory — use list_dir]`;
      let text = fs.readFileSync(f, "utf8");
      if (input.start_line || input.end_line) {
        const lines = text.split("\n");
        const s = Math.max(0, (input.start_line ?? 1) - 1);
        const e = input.end_line ?? lines.length;
        text = lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join("\n");
      }
      return cap(text, 60000);
    }
    if (name === "grep") {
      // grep -rnE: universal (no ripgrep dependency). Exit 1 == no matches.
      const args = ["-rnE"];
      if (input.glob) args.push("--include=" + input.glob);
      args.push("--", input.pattern, safe(input.path ?? "."));
      try {
        const out = execFileSync("grep", args, { cwd: root, encoding: "utf8", maxBuffer: 8e6 });
        // Strip the absolute root prefix so paths read as repo-relative.
        const rel = out.split("\n").map((l) => l.replace(root + path.sep, "")).join("\n");
        return cap(rel.trimEnd() || "[no matches]", 40000);
      } catch (e) {
        if (e.status === 1) return "[no matches]";
        return `[grep error: ${e.message}]`;
      }
    }
    return `[unknown tool: ${name}]`;
  }

  return { label: "grep+read", tools, execute, close: () => {} };
}
