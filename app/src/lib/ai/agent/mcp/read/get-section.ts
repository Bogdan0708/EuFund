// ── MCP Handler: get_section ──────────────────────────────────────────────
// Registers the get_section tool on the read MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSection } from '../../services/sections'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

// sessionId is implicit on ctx — see get-application-state.ts header.
export const inputShape = {
  sectionKey: z.string().min(1),
}

export const inputSchema = z.object(inputShape)

export function registerGetSection(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_section',
    'Load a single section by section key for the current session. Returns full content, accepted content, model metadata, and error class.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      requireSession(ctx)
      const result = await getSection(ctx, ctx.sessionId, args.sectionKey)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
