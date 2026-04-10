// ── MCP Handler: search_calls ─────────────────────────────────────────────
// Registers the search_calls tool on the read MCP server.
// Delegates business logic to the evidence service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { searchCalls } from '../../services/evidence'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  query: z.string().min(1),
  program: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
}

export function registerSearchCalls(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'search_calls',
    'Search EU funding calls by semantic similarity. Returns ranked matches with call ID, title, program, relevance score, and a short snippet.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await searchCalls(ctx, args.query, {
        program: args.program,
        maxResults: args.maxResults,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
