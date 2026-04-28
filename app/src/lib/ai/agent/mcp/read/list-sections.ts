// ── MCP Handler: list_sections ────────────────────────────────────────────
// Registers the list_sections tool on the read MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listSections } from '../../services/sections'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

// sessionId is implicit on ctx — see get-application-state.ts header.
export const inputShape = {}

export const inputSchema = z.object(inputShape)

export function registerListSections(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'list_sections',
    'List all sections for the current agent session. Returns section metadata (key, title, status, order) without content.',
    inputShape,
    withMcpErrorMapping(async () => {
      requireSession(ctx)
      const result = await listSections(ctx, ctx.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
