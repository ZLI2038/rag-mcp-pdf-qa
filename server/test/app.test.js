import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../app.js";
import { createRagChat } from "../chat.js";
import { parsePdf, createDocumentStore } from "../documents.js";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { makePdf } from "./fixture.js";

async function serve(t, options = {}) {
  const app = createApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  const owner = randomUUID();
  const request = (url, init = {}, session = owner) => fetch(base + url, {
    ...init, headers: { ...(session ? { "X-Session-Id": session } : {}), ...init.headers },
  });
  const upload = (bytes = makePdf(), name = "sample.pdf", type = "application/pdf", session = owner) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    return request("/upload", { method: "POST", body: form }, session);
  };
  return { request, upload, owner };
}

test("real PDF parser preserves fixture text and creates bounded chunks", async () => {
  const parsed = await parsePdf(makePdf());
  assert.equal(parsed.pages, 1);
  assert(parsed.chunks.some(chunk => chunk.pageContent.includes("Orchids")));
  assert(parsed.chunks.every(chunk => chunk.pageContent.length <= 500));
});

test("HTTP upload requires a session and a file", async t => {
  const api = await serve(t);
  assert.equal((await api.upload(undefined, undefined, undefined, null)).status, 401);
  const missing = await api.request("/upload", { method: "POST", body: new FormData() });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /attach a PDF/);
});

test("rejects non-PDF extension, content spoofing and malformed PDFs", async t => {
  const api = await serve(t);
  assert.equal((await api.upload(Buffer.from("text"), "text.txt", "text/plain")).status, 415);
  assert.equal((await api.upload(Buffer.from("not a PDF"))).status, 415);
  assert.equal((await api.upload(Buffer.from("%PDF-1.4\ninvalid"))).status, 422);
});

test("rejects PDFs without extractable text", async t => {
  const api = await serve(t);
  assert.equal((await api.upload(makePdf(" "))).status, 422);
});

test("enforces file size and single-file limits", async t => {
  const api = await serve(t, { maxFileBytes: 100 });
  assert.equal((await api.upload()).status, 413);
  const ordinary = await serve(t);
  const form = new FormData();
  for (const name of ["one.pdf", "two.pdf"]) form.append("file", new Blob([makePdf()]), name);
  assert.equal((await ordinary.request("/upload", { method: "POST", body: form })).status, 400);
});

test("two sessions cannot read or delete each other's document, even with its ID", async t => {
  const api = await serve(t, {
    ragChat: async document => ({ text: document.chunks.map(chunk => chunk.pageContent).join("") }),
    webChat: async () => ({ text: "Web fixture" }),
  });
  const other = randomUUID();
  const a = await (await api.upload(makePdf("Alpha document"))).json();
  const b = await (await api.upload(makePdf("Beta document"), "same.pdf", "application/pdf", other)).json();
  const query = documentId => "/chat?" + new URLSearchParams({ documentId, question: "What is in the document?" });
  assert.notEqual(a.documentId, b.documentId);
  assert.equal((await api.request(query(a.documentId), {}, other)).status, 404);
  assert.equal((await api.request("/documents/" + a.documentId, { method: "DELETE" }, other)).status, 404);
  const answerA = await (await api.request(query(a.documentId))).json();
  const answerB = await (await api.request(query(b.documentId), {}, other)).json();
  assert.match(answerA.ragAnswer, /Alpha/);
  assert.match(answerB.ragAnswer, /Beta/);
  assert.equal(answerA.mcpAnswer, "Web fixture");
});

test("a later same-named upload does not overwrite an earlier document", async t => {
  const api = await serve(t, { ragChat: async d => ({ text: d.chunks[0].pageContent }), webChat: async () => ({ text: "web" }) });
  const first = await (await api.upload(makePdf("First document"))).json();
  const second = await (await api.upload(makePdf("Second document"))).json();
  assert.notEqual(first.documentId, second.documentId);
  const response = await api.request("/chat?" + new URLSearchParams({ documentId: first.documentId, question: "Which?" }));
  assert.match((await response.json()).ragAnswer, /First/);
});

test("HTTP rejects missing, blank, repeated and overlong question parameters", async t => {
  let calls = 0;
  const api = await serve(t, { ragChat: async () => { calls++; }, webChat: async () => { calls++; } });
  const document = await (await api.upload()).json();
  for (const suffix of ["", "&question=%20%20", "&question=a&question=b", "&question=" + "a".repeat(2001)]) {
    assert.equal((await api.request("/chat?documentId=" + document.documentId + suffix)).status, 400);
  }
  assert.equal((await api.request("/chat?question=test&documentId=../secret")).status, 400);
  assert.equal(calls, 0);
});

test("deleting a document invalidates its ID", async t => {
  const api = await serve(t);
  const doc = await (await api.upload()).json();
  assert.equal((await api.request("/documents/" + doc.documentId, { method: "DELETE" })).status, 204);
  assert.equal((await api.request("/chat?" + new URLSearchParams({ documentId: doc.documentId, question: "test" }))).status, 404);
});

test("upstream errors return a sanitized JSON error", async t => {
  const api = await serve(t, { ragChat: async () => { throw new Error("private-provider-secret"); } });
  const doc = await (await api.upload()).json();
  const response = await api.request("/chat?" + new URLSearchParams({ documentId: doc.documentId, question: "test" }));
  assert.equal(response.status, 502);
  assert(!JSON.stringify(await response.json()).includes("private-provider-secret"));
});

test("full HTTP to real parser/retriever pipeline reuses one index for concurrent and later questions", async t => {
  let parses = 0, indexes = 0, embeddedBatches = 0, generations = 0;
  const ragChat = createRagChat({
    buildIndex: async chunks => {
      indexes++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return MemoryVectorStore.fromDocuments(chunks, {
        embedDocuments: async texts => { embeddedBatches++; return texts.map(() => [1, 0]); },
        embedQuery: async () => [1, 0],
      });
    },
    createModel: () => ({ invoke: async prompt => { generations++; assert.match(prompt, /Orchids/); return { content: "Water once a week." }; } }),
  });
  const api = await serve(t, { ragChat, parseDocument: async bytes => { parses++; return parsePdf(bytes); }, webChat: async () => ({ text: "Search summary." }) });
  const upload = await api.upload();
  assert.equal(upload.status, 201);
  const doc = await upload.json();
  const ask = () => api.request("/chat?" + new URLSearchParams({ documentId: doc.documentId, question: "How often should I water it?" }));
  const responses = await Promise.all([ask(), ask()]);
  responses.push(await ask());
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ragAnswer: "Water once a week.", mcpAnswer: "Search summary." });
  }
  assert.deepEqual({ parses, indexes, embeddedBatches, generations }, { parses: 1, indexes: 1, embeddedBatches: 1, generations: 3 });
});

test("failed indexing can be retried without permanently caching the rejection", async () => {
  let builds = 0;
  const rag = createRagChat({
    buildIndex: async () => {
      if (++builds === 1) throw new Error("Temporary failure");
      return { asRetriever: () => ({ invoke: async () => [{ pageContent: "context" }] }) };
    },
    createModel: () => ({ invoke: async () => ({ content: "answer" }) }),
  });
  const doc = { chunks: [], indexPromise: null };
  await assert.rejects(rag(doc, "Question"));
  assert.equal((await rag(doc, "Question")).text, "answer");
  assert.equal(builds, 2);
});

test("document store expires entries and enforces per-session and global capacity", () => {
  let clock = 0;
  const store = createDocumentStore({ ttlMs: 100, maxPerSession: 1, maxDocuments: 2, now: () => clock });
  const doc = store.add("one", "one.pdf", { chunks: [] });
  assert.throws(() => store.add("one", "two.pdf", { chunks: [] }), error => error.status === 429);
  store.add("two", "two.pdf", { chunks: [] });
  assert.throws(() => store.add("three", "three.pdf", { chunks: [] }), error => error.status === 503);
  clock = 101;
  assert.throws(() => store.get("one", doc.id), error => error.status === 404);
  assert(store.add("three", "three.pdf", { chunks: [] }).id);
});
