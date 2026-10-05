import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { createSearchServer } from "../mcp-server.js";
import { createMcpChat } from "../chat-mcp.js";

async function connect(t, options) {
  const server = createSearchServer(options);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
test("MCP rejects missing/type-invalid/blank/oversized queries and out-of-range result limits before searching", async t => {
  let searches = 0;
  const client = await connect(t, { apiKey: "fixture", search: async () => { searches++; return {}; } });
  const cases = [
    {}, { query: 7 }, { query: null }, { query: [] }, { query: "" }, { query: "   " }, { query: "a".repeat(2001) },
    { query: "test", num: "5" }, { query: "test", num: null }, { query: "test", num: true },
    { query: "test", num: 0 }, { query: "test", num: -1 }, { query: "test", num: 1.5 }, { query: "test", num: 11 },
  ];
  for (const args of cases) {
    const result = await client.callTool({ name: "search_web", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(searches, 0);
});
test("MCP trims search text, applies default count, and limits returned results", async t => {
  const requests = [];
  const client = await connect(t, { apiKey: "fixture", search: async request => {
    requests.push(request);
    return { organic_results: Array.from({ length: 15 }, (_, i) => ({ title: String(i), snippet: "text", privateField: "hidden" })) };
  } });
  const result = await client.callTool({ name: "search_web", arguments: { query: "  orchids  ", num: 5 } });
  assert.equal(requests[0].q, "orchids");
  const items = JSON.parse(result.content[0].text).results;
  assert.equal(items.length, 5);
  assert(!JSON.stringify(items).includes("privateField"));
  await client.callTool({ name: "search_web", arguments: { query: "orchids" } });
  assert.equal(requests[1].num, 10);
});
test("MCP provider errors do not leak credentials or error details", async t => {
  const client = await connect(t, { apiKey: "fixture", search: async () => { throw new Error("secret provider URL"); } });
  const result = await client.callTool({ name: "search_web", arguments: { query: "test" } });
  assert.equal(result.isError, true);
  assert(!JSON.stringify(result).includes("secret"));
});
test("real stdio subprocess handshake and missing-key response work without network access", async t => {
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("../mcp-server.js", import.meta.url))],
    env: { ...process.env, SERPAPI_KEY: "", OPENAI_API_KEY: "" },
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, "search_web");
  const result = await client.callTool({ name: "search_web", arguments: { query: "test" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not configured/);
});
test("concurrent first MCP questions await one completed connection and reuse it later", async () => {
  let clients = 0, connects = 0, calls = 0, ready = false;
  const mcp = createMcpChat({
    createClient: () => {
      clients++;
      return { connect: async () => { connects++; await new Promise(resolve => setTimeout(resolve, 20)); ready = true; },
        callTool: async () => { assert(ready); calls++; return { content: [{ type: "text", text: "result" }] }; },
        close: async () => {} };
    },
    createTransport: () => ({}),
    createModel: () => ({ invoke: async () => ({ content: "answer" }) }),
  });
  await Promise.all([mcp.ask("one"), mcp.ask("two")]);
  await mcp.ask("three");
  assert.deepEqual({ clients, connects, calls }, { clients: 1, connects: 1, calls: 3 });
  await mcp.close();
});
test("a failed MCP connection is closed and the next request reconnects", async () => {
  let connects = 0, closes = 0;
  const mcp = createMcpChat({
    createClient: () => ({
      connect: async () => { if (++connects === 1) throw new Error("Connection failed"); },
      callTool: async () => ({ content: [{ type: "text", text: "result" }] }),
      close: async () => { closes++; },
    }),
    createTransport: () => ({}),
    createModel: () => ({ invoke: async () => ({ content: "answer" }) }),
  });
  await assert.rejects(mcp.ask("first"));
  assert.equal((await mcp.ask("second")).text, "answer");
  assert.equal(connects, 2);
  assert.equal(closes, 1);
  await mcp.close();
});
