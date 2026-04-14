// ── MCP Handler: refresh_call_freshness ───────────────────────────────────
// Registers the refresh_call_freshness tool on the research MCP server.
// Delegates business logic to the freshness service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { refreshCallFreshness } from '../../services/freshness'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  callId: z.string().min(1),
}

export function registerRefreshCallFreshness(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'refresh_call_freshness',
    'Check if an EU funding call is still open using a live AI-powered web search. Makes an external network call — may be slow. Returns isOpen status, amendments list, warnings, and a confidence score.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await refreshCallFreshness(ctx, args.callId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
