#!/usr/bin/env node
/**
 * MCP FET Integration — stdio MCP server.
 * Exposes Liviu Lalescu's FET timetable generator via Model Context Protocol tools.
 *
 * Logging must use stderr only; stdout is reserved for MCP JSON-RPC.
 * For ChatGPT cloud / remote connectors use the Streamable HTTP bridge: `npm run mcp:http`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { SERVER_INFO } from "./config.js";
import { ensureDataDirs } from "./fet/paths.js";
import { createFetMcpServer } from "./serverFactory.js";

async function main(): Promise<void> {
  ensureDataDirs();
  const server = createFetMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_INFO.name} v${SERVER_INFO.version} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
