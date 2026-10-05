import express from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import chat from "./chat.js";
import chatMCP from "./chat-mcp.js";
import { createDocumentStore, MAX_FILE_BYTES, parsePdf } from "./documents.js";
import { HttpError } from "./errors.js";

const idSchema = z.string().uuid();
const questionSchema = z.string().trim().min(1).max(2000);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function createApp({ documents = createDocumentStore(), parseDocument = parsePdf, ragChat = chat, webChat = chatMCP,
  maxFileBytes = MAX_FILE_BYTES, allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000").split(",").map(value => value.trim()),
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: allowedOrigins }));
  app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use((req, res, next) => {
    const parsed = idSchema.safeParse(req.get("X-Session-Id"));
    if (!parsed.success) return next(new HttpError(401, "A valid browser session is required."));
    req.sessionId = parsed.data;
    next();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileBytes, files: 1, fields: 0 },
    fileFilter(req, file, callback) {
      const validType = ["application/pdf", "application/octet-stream"].includes(file.mimetype);
      if (!/\.pdf$/i.test(file.originalname) || !validType) return callback(new HttpError(415, "Upload a PDF file only."));
      callback(null, true);
    },
  });
  app.post("/upload", upload.single("file"), asyncRoute(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Please attach a PDF in the file field.");
    const parsed = await parseDocument(req.file.buffer);
    const name = req.file.originalname.replaceAll("\\", "/").split("/").pop();
    const document = documents.add(req.sessionId, name, parsed);
    res.status(201).json({ documentId: document.id, name: document.name, pages: document.pages, chunks: document.chunks.length });
  }));
  app.get("/chat", asyncRoute(async (req, res) => {
    const question = questionSchema.safeParse(req.query.question);
    if (!question.success) throw new HttpError(400, "Provide a question between 1 and 2000 characters.");
    const id = idSchema.safeParse(req.query.documentId);
    if (!id.success) throw new HttpError(400, "Upload a PDF and provide its documentId.");
    const document = documents.get(req.sessionId, id.data);
    const rag = await ragChat(document, question.data);
    const web = await webChat(question.data);
    res.json({ ragAnswer: rag.text, mcpAnswer: web.text });
  }));
  app.delete("/documents/:id", (req, res, next) => {
    try {
      if (!idSchema.safeParse(req.params.id).success) throw new HttpError(400, "Invalid documentId.");
      documents.remove(req.sessionId, req.params.id);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "The PDF exceeds the upload size limit." : "Attach exactly one PDF in the file field." });
    }
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error("Request failed:", error.name || "Error");
    return res.status(502).json({ error: "The request could not be completed. Check the server's API configuration and try again." });
  });
  return app;
}
