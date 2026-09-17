// Opt-in smoke test. Sends only the original, synthetic fixture in test/fixture.js.
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { closeMcp } from "./chat-mcp.js";
import { makePdf } from "./test/fixture.js";

if (process.env.ALLOW_LIVE_API_TESTS !== "1") {
  console.error("Set ALLOW_LIVE_API_TESTS=1 to allow a small number of paid API calls using a synthetic PDF.");
  process.exit(1);
}
dotenv.config({ path: new URL("./.env", import.meta.url) });
if (!process.env.OPENAI_API_KEY || !process.env.SERPAPI_KEY) throw new Error("Both API keys are required.");
const server = createApp().listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const headers = { "X-Session-Id": randomUUID() };
const timeout = setTimeout(() => { console.error("Live smoke test timed out."); process.exit(1); }, 180000);
try {
  const form = new FormData();
  form.append("file", new Blob([makePdf()], { type: "application/pdf" }), "synthetic-orchid-guide.pdf");
  const upload = await fetch(base + "/upload", { method: "POST", headers, body: form });
  assert.equal(upload.status, 201);
  const document = await upload.json();
  const started = performance.now();
  const response = await fetch(base + "/chat?" + new URLSearchParams({
    documentId: document.documentId, question: "According to the document, how often should I water the orchid?",
  }), { headers, signal: AbortSignal.timeout(150000) });
  const answer = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof answer.ragAnswer, "string");
  assert.equal(typeof answer.mcpAnswer, "string");
  assert(answer.ragAnswer.trim() && answer.mcpAnswer.trim());
  assert.match(answer.ragAnswer, /week|seven|7\s*days/i);
  console.log(JSON.stringify({ passed: true, fixture: "synthetic-orchid-guide", pages: document.pages,
    chunks: document.chunks, status: response.status, answerFields: Object.keys(answer), elapsedMs: performance.now() - started }));
} finally {
  clearTimeout(timeout);
  await closeMcp();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
