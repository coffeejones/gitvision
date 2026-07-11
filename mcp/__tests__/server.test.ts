// In-process MCP server tests (v0.66 / C1.3).
//
// Verify the server boots, exposes the right tools with valid input
// schemas, and round-trips JSON-RPC correctly — without forking a
// child process or going through stdio. We use the SDK's
// InMemoryTransport.createLinkedPair() to wire a Client + Server
// directly together in-process, then drive the Client API.
//
// We do NOT exercise the analyze_repo tool here — that would hit
// GitHub's API, download a tarball, and run tree-sitter parsing,
// which is heavy + flaky for unit tests. The libs underneath
// (lib/github, lib/codeAnalysis) have their own coverage; this
// suite is specifically about the MCP wiring layer.

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "../buildServer";

/** Set up a Client connected in-process to a fresh CodeTrawl MCP
 *  server. Returns the connected client + a cleanup function. */
async function connectInMemory() {
  const server = buildServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "codetrawl-mcp-tests", version: "0.0.0" },
    { capabilities: {} }
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("MCP server · initialization", () => {
  it("reports the expected server name + version", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const info = client.getServerVersion();
      expect(info?.name).toBe(SERVER_NAME);
      expect(info?.version).toBe(SERVER_VERSION);
    } finally {
      await cleanup();
    }
  });

  it("advertises tools capability", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const caps = client.getServerCapabilities();
      expect(caps?.tools).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});

describe("MCP server · tools/list", () => {
  it("exposes all nine CodeTrawl tools", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "analyze_diff",
        "analyze_repo",
        "blast_radius",
        "compare_sessions",
        "find_duplicates",
        "review_changes",
        "signals",
        "simulate_change",
        "untested_hotspots",
      ]);
    } finally {
      await cleanup();
    }
  });

  it("each tool has a description and an inputSchema", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description!.length).toBeGreaterThan(20);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    } finally {
      await cleanup();
    }
  });

  it("single-session downstream tools require sessionId in their schema", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      const downstream = ["blast_radius", "find_duplicates", "signals", "untested_hotspots", "simulate_change"];
      for (const name of downstream) {
        const tool = result.tools.find((t) => t.name === name);
        expect(tool, `tool ${name} should be registered`).toBeDefined();
        const schema = tool!.inputSchema as { required?: string[] };
        expect(schema.required, `tool ${name} should require sessionId`).toContain(
          "sessionId"
        );
      }
    } finally {
      await cleanup();
    }
  });

  it("compare_sessions requires fromSessionId + toSessionId", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "compare_sessions");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as { required?: string[] };
      expect(schema.required).toContain("fromSessionId");
      expect(schema.required).toContain("toSessionId");
    } finally {
      await cleanup();
    }
  });

  it("analyze_diff requires baseSessionId + headSessionId", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "analyze_diff");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as { required?: string[] };
      expect(schema.required).toContain("baseSessionId");
      expect(schema.required).toContain("headSessionId");
    } finally {
      await cleanup();
    }
  });

  it("review_changes requires baseSessionId + headSessionId", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "review_changes");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as { required?: string[] };
      expect(schema.required).toContain("baseSessionId");
      expect(schema.required).toContain("headSessionId");
      // maxResults is optional — don't require it
      expect(schema.required).not.toContain("maxResults");
    } finally {
      await cleanup();
    }
  });
});

describe("MCP server · tool error paths", () => {
  it("blast_radius returns an error when called with a non-existent sessionId", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "blast_radius",
        arguments: {
          sessionId: "does-not-exist",
          file: "src/foo.ts",
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toMatch(/not found|expired/i);
    } finally {
      await cleanup();
    }
  });

  it("find_duplicates returns an error for unknown session", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "find_duplicates",
        arguments: { sessionId: "nope" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("untested_hotspots returns an error for unknown session", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "untested_hotspots",
        arguments: { sessionId: "nope" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("signals returns an error for unknown session", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "signals",
        arguments: { sessionId: "nope" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("simulate_change returns an error for unknown session", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "simulate_change",
        arguments: {
          sessionId: "does-not-exist",
          changes: [{ path: "src/foo.ts", newContent: "export const x = 1;" }],
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toMatch(/not found|expired/i);
    } finally {
      await cleanup();
    }
  });

  it("compare_sessions returns an error when either side is missing", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "compare_sessions",
        arguments: { fromSessionId: "nope-from", toSessionId: "nope-to" },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      // The first-missing path fires first — the error should name the
      // earlier session that wasn't found.
      expect(content[0].text).toMatch(/nope-from/);
    } finally {
      await cleanup();
    }
  });

  it("analyze_diff returns an error when either side is missing", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "analyze_diff",
        arguments: { baseSessionId: "nope-base", headSessionId: "nope-head" },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      // Base is checked first — error should reference the base session
      expect(content[0].text).toMatch(/nope-base/);
    } finally {
      await cleanup();
    }
  });

  it("review_changes returns an error when either side is missing", async () => {
    const { client, cleanup } = await connectInMemory();
    try {
      const result = await client.callTool({
        name: "review_changes",
        arguments: { baseSessionId: "nope-base", headSessionId: "nope-head" },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      // Base is checked first — error should reference the base session
      expect(content[0].text).toMatch(/nope-base/);
    } finally {
      await cleanup();
    }
  });
});
