// ── MCP Server Factory ────────────────────────────────────────────────────────
// Creates a named McpServer instance for a given domain (e.g. "read", "write").
// Each domain server is registered independently and mounted via HTTP transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export function createMcpDomain(name: string, version: string): McpServer {
  return new McpServer({ name, version })
}
