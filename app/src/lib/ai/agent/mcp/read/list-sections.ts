// ── MCP Handler: list_sections ────────────────────────────────────────────
// Registers the list_sections tool on the read MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listSections } from '../../services/sections'
import type { ServiceContext } from '../../services/types'

const inputShape = {
  sessionId: z.string().uuid(),
}

export function registerListSections(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'list_sections',
    'List all sections for an agent session. Returns section metadata (key, title, status, order) without content. Verifies session ownership.',
    inputShape,
    async (args) => {
      const result = await listSections(ctx, args.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
