import { randomUUID } from "node:crypto";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { HttpError } from "./errors.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function parsePdf(buffer) {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new HttpError(415, "The uploaded file is not a PDF.");
  }
  let pages;
  try { pages = await new PDFLoader(new Blob([buffer])).load(); }
  catch { throw new HttpError(422, "This PDF cannot be read. Upload a valid, unencrypted PDF."); }
  const pageCount = pages[0]?.metadata.pdf?.totalPages || pages.length;
  if (pageCount > 200) throw new HttpError(413, "PDFs must contain no more than 200 pages.");
  const characters = pages.reduce((total, page) => total + page.pageContent.length, 0);
  if (!pages.some(page => page.pageContent.trim())) {
    throw new HttpError(422, "No readable text found. Scanned PDFs require OCR before uploading.");
  }
  if (characters > 1000000) throw new HttpError(413, "The PDF contains too much text.");
  const chunks = await new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 0 }).splitDocuments(pages);
  for (const chunk of chunks) chunk.metadata = { page: chunk.metadata.loc?.pageNumber };
  return { chunks, pages: pageCount, characters };
}

export function createDocumentStore({ ttlMs = 60 * 60 * 1000, maxDocuments = 50, maxPerSession = 5, now = Date.now } = {}) {
  const documents = new Map();
  const prune = () => {
    for (const [id, document] of documents) {
      if (now() - document.lastUsed >= ttlMs) documents.delete(id);
    }
  };
  return {
    prune,
    add(owner, name, parsed) {
      prune();
      const owned = [...documents.values()].filter(document => document.owner === owner);
      if (owned.length >= maxPerSession) throw new HttpError(429, "Too many documents in this session. Remove a document first.");
      if (documents.size >= maxDocuments) throw new HttpError(503, "Document storage is full. Please try again later.");
      const document = { ...parsed, id: randomUUID(), owner, name, lastUsed: now(), indexPromise: null };
      documents.set(document.id, document);
      return document;
    },
    get(owner, id) {
      prune();
      const document = documents.get(id);
      if (!document || document.owner !== owner) throw new HttpError(404, "Document not found or expired. Please upload it again.");
      document.lastUsed = now();
      return document;
    },
    remove(owner, id) { this.get(owner, id); documents.delete(id); },
    clear() { documents.clear(); },
  };
}
