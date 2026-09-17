import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createDocumentStore } from "./documents.js";
import { closeMcp } from "./chat-mcp.js";

dotenv.config({ path: new URL("./.env", import.meta.url) });
const documents = createDocumentStore();
const app = createApp({ documents });
const server = app.listen(Number(process.env.PORT || 5001), process.env.HOST || "127.0.0.1", () => {
  console.log(`Server is running on port ${server.address().port}`);
});
const cleanup = setInterval(() => documents.prune(), 60000);
cleanup.unref();
const shutdown = () => {
  clearInterval(cleanup);
  documents.clear();
  server.close(async () => { await closeMcp(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
