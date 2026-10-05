import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { once } from "node:events";

test("server entrypoint starts outside its own directory and shuts down cleanly", async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.js", import.meta.url))], {
    cwd: tmpdir(), env: { ...process.env, PORT: "0", HOST: "127.0.0.1", OPENAI_API_KEY: "", SERPAPI_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Startup timeout")), 10000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited before startup")); });
    child.stdout.on("data", data => {
      const match = data.toString().match(/port (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const response = await fetch("http://127.0.0.1:" + port + "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const [code] = await exited;
  assert.equal(code, 0);
});
