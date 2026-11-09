#!/usr/bin/env node
/**
 * Local MCP Streamable HTTP bridge for ChatGPT / remote MCP clients.
 *
 * Default bind: 127.0.0.1:3847 (loopback only).
 * MCP endpoint: POST/GET http://127.0.0.1:3847/mcp
 * Health: GET http://127.0.0.1:3847/health
 *
 * Env:
 *   MCP_HTTP_HOST          default 127.0.0.1
 *   MCP_HTTP_PORT          default 3847
 *   MCP_HTTP_PATH          default /mcp
 *   MCP_HTTP_TOKEN         optional shared Bearer token
 *   MCP_HTTP_ALLOWED_HOSTS comma-separated Host allowlist (needed for tunnels)
 *   FET_CL_PATH            same as stdio server
 *
 * Logging uses stderr only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  createMcpHandler,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { SERVER_INFO } from "./config.js";
import { ensureDataDirs } from "./fet/paths.js";
import { createFetMcpServer } from "./serverFactory.js";

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function parseAllowedHosts(): string[] {
  const raw = process.env.MCP_HTTP_ALLOWED_HOSTS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function extractBearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

async function main(): Promise<void> {
  ensureDataDirs();

  const host = envString("MCP_HTTP_HOST", "127.0.0.1");
  const port = Number(envString("MCP_HTTP_PORT", "3847"));
  const mcpPath = envString("MCP_HTTP_PATH", "/mcp").replace(/\/+$/, "") || "/mcp";
  const token = process.env.MCP_HTTP_TOKEN?.trim() || "";
  const allowedHosts = parseAllowedHosts();

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${process.env.MCP_HTTP_PORT}`);
  }

  if (!isLoopbackHost(host)) {
    console.error(
      `[warn] Binding ${host} (not loopback). Prefer 127.0.0.1 + a local tunnel. ` +
        `Set MCP_HTTP_TOKEN and MCP_HTTP_ALLOWED_HOSTS.`,
    );
  }
  if (allowedHosts.length > 0 && !token) {
    throw new Error(
      "MCP_HTTP_TOKEN is required when MCP_HTTP_ALLOWED_HOSTS is set " +
        "(public/tunnel Host headers must not be open).",
    );
  }

  let warnedAnonTunnel = false;

  const handler = createMcpHandler(
    () => createFetMcpServer(),
    {
      onerror: (err) => {
        console.error("[mcp http]", err);
      },
    },
  );

  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => {
      console.error("[mcp http adapter]", err);
    },
  });

  const validateHost =
    allowedHosts.length > 0
      ? hostHeaderValidation(["127.0.0.1", "localhost", "[::1]", ...allowedHosts])
      : localhostHostValidation();
  // Requests without Origin pass. If a browser Origin is present (rare for ChatGPT
  // server-side calls), allow localhost + tunnel hosts + ChatGPT web origins.
  const validateOrigin =
    allowedHosts.length > 0
      ? originValidation([
          "127.0.0.1",
          "localhost",
          "[::1]",
          ...allowedHosts,
          "chatgpt.com",
          "www.chatgpt.com",
          "chat.openai.com",
        ])
      : localhostOriginValidation();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

        if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
          sendJson(res, 200, {
            ok: true,
            server: SERVER_INFO.name,
            version: SERVER_INFO.version,
            transport: "streamable-http",
            mcpPath,
            bind: `${host}:${port}`,
            auth: token ? "bearer" : "none",
          });
          return;
        }

        if (url.pathname !== mcpPath && url.pathname !== `${mcpPath}/`) {
          sendJson(res, 404, { error: "not_found", hint: `MCP endpoint is ${mcpPath}` });
          return;
        }

        if (!validateHost(req, res) || !validateOrigin(req, res)) {
          return;
        }

        if (token) {
          const presented = extractBearer(req);
          if (presented) {
            if (!tokensEqual(presented, token)) {
              res.writeHead(401, {
                "Content-Type": "application/json; charset=utf-8",
                "WWW-Authenticate": 'Bearer realm="mcp-fet-integration"',
              });
              res.end(JSON.stringify({ error: "unauthorized", hint: "Authorization: Bearer <MCP_HTTP_TOKEN>" }));
              return;
            }
            const authInfo: AuthInfo = {
              token: presented,
              clientId: "shared-token",
              scopes: ["mcp"],
              expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
            };
            (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
          } else {
            // ChatGPT plugin UI often offers only OAuth / nessuna auth (no Bearer header).
            // Allow missing Bearer only when Host is an explicit tunnel allowlist entry.
            const hostHdr = String(req.headers.host ?? "").toLowerCase();
            const hostname = hostHdr.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
            const tunnelHostOk =
              allowedHosts.length > 0 &&
              allowedHosts.some((h) => h === hostname || h === hostHdr);
            if (!tunnelHostOk) {
              res.writeHead(401, {
                "Content-Type": "application/json; charset=utf-8",
                "WWW-Authenticate": 'Bearer realm="mcp-fet-integration"',
              });
              res.end(JSON.stringify({ error: "unauthorized", hint: "Authorization: Bearer <MCP_HTTP_TOKEN>" }));
              return;
            }
            if (!warnedAnonTunnel) {
              warnedAnonTunnel = true;
              console.error(
                "[warn] Tunnel Host request without Bearer (ChatGPT no-auth UI). " +
                  "Prefer OpenAI Secure MCP Tunnel + tunnel-client --mcp.extra-headers. " +
                  "Keep the public tunnel short-lived.",
              );
            }
          }
        }

        await nodeHandler(req, res);
      } catch (err) {
        console.error("[mcp http request]", err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal_error" });
        } else {
          res.end();
        }
      }
    })();
  });

  const shutdown = async (signal: string) => {
    console.error(`Shutting down (${signal})…`);
    server.close();
    await handler.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const base = `http://${host}:${port}`;
  console.error(`${SERVER_INFO.name} v${SERVER_INFO.version} Streamable HTTP bridge`);
  console.error(`  health: ${base}/health`);
  console.error(`  mcp:    ${base}${mcpPath}`);
  console.error(`  auth:   ${token ? "Bearer token required (MCP_HTTP_TOKEN)" : "none (loopback)"}`);
  if (allowedHosts.length > 0) {
    console.error(`  hosts:  ${["127.0.0.1", "localhost", ...allowedHosts].join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
