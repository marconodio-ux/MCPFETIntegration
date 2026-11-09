/**
 * Smoke: start Streamable HTTP bridge, hit /health + initialize, stop.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = String(3847 + Math.floor(Math.random() * 200));
const host = "127.0.0.1";
const base = `http://${host}:${port}`;
const token = "smoke-token-mfi10";
const bridgeJs = path.join(root, "build", "httpBridge.js");

const child = spawn(process.execPath, [bridgeJs], {
  cwd: root,
  env: {
    ...process.env,
    MCP_HTTP_HOST: host,
    MCP_HTTP_PORT: port,
    MCP_HTTP_TOKEN: token,
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Bridge exited early (${child.exitCode}): ${stderr}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    await sleep(150);
  }
  throw new Error(`Bridge did not become ready. stderr:\n${stderr}`);
}

async function initialize() {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "smoke-http-bridge", version: "0.0.1" },
      },
    }),
  });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") || "", body: text };
}

function stopChild() {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolve(code ?? 0));
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000);
  });
}

let failed = false;
try {
  const health = await waitReady();
  if (!health?.ok) throw new Error(`Bad health: ${JSON.stringify(health)}`);
  console.log("health ok:", JSON.stringify(health));

  const init = await initialize();
  console.log("initialize status:", init.status, init.contentType);
  if (init.status < 200 || init.status >= 300) {
    throw new Error(`initialize HTTP ${init.status}: ${init.body.slice(0, 500)}`);
  }
  const looksJson = init.body.includes("jsonrpc") || init.body.includes("result") || init.body.includes("serverInfo");
  const looksSse = init.body.includes("data:") || (init.contentType.includes("text/event-stream") && init.body.length > 0);
  if (!looksJson && !looksSse) {
    throw new Error(`Unexpected initialize body: ${init.body.slice(0, 500)}`);
  }
  console.log("initialize ok (streamable http)");
} catch (err) {
  failed = true;
  console.error("SMOKE FAIL:", err instanceof Error ? err.message : err);
} finally {
  await stopChild();
}

process.exit(failed ? 1 : 0);
