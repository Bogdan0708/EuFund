// ── MCP Handler: get_section ──────────────────────────────────────────────
// Registers the get_section tool on the read MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSection } from '../../services/sections'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

export const inputShape = {
  sessionId: z.string().uuid(),
  sectionKey: z.string().min(1),
}

export const inputSchema = z.object(inputShape)

export function registerGetSection(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_section',
    'Load a single section by session and section key. Returns full content, accepted content, model metadata, and error class. Verifies session ownership. Throws if section not found.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await getSection(ctx, args.sessionId, args.sectionKey)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
