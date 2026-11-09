/**
 * Shared MCP server factory for stdio and Streamable HTTP entry points.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_INFO } from "./config.js";
import { registerFetTools } from "./tools/register.js";

export function createFetMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
  });
  registerFetTools(server);
  return server;
}
