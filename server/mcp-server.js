import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getJson } from "serpapi";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function createSearchServer({ search = getJson, apiKey = process.env.SERPAPI_KEY } = {}) {
  const server = new McpServer({ name: "serpapi-search", version: "1.0.0" });
  server.registerTool("search_web", {
    description: "Search the web and return up to num organic results.",
    inputSchema: {
      query: z.string().trim().min(1).max(2000).describe("Non-empty search query (up to 2000 characters)"),
      num: z.number().int().min(1).max(10).optional().describe("Result limit, integer from 1 to 10 (default: 10)"),
    },
  }, async ({ query, num = 10 }) => {
    if (!apiKey) return { isError: true, content: [{ type: "text", text: "SERPAPI_KEY is not configured" }] };
    try {
      const results = await search({ engine: "google", q: query, num, api_key: apiKey });
      if (results.error) throw new Error("Search provider returned an error");
      const items = (results.organic_results || []).slice(0, num).map(({ title, link, snippet }) => ({ title, link, snippet }));
      return { content: [{ type: "text", text: JSON.stringify({ results: items }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "The search provider request failed." }] };
    }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createSearchServer().connect(new StdioServerTransport()).catch(() => {
    console.error("MCP server failed to start.");
    process.exit(1);
  });
}
