// ── MCP Handler: get_call_blueprint ───────────────────────────────────────
// Registers the get_call_blueprint tool on the read MCP server.
// Delegates business logic to the blueprint service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { lookupBlueprint } from '../../services/blueprint'
import type { ServiceContext } from '../../services/types'

const inputShape = {
  callId: z.string().min(1),
}

export function registerGetCallBlueprint(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_call_blueprint',
    'Look up the cached blueprint for an EU funding call. Returns the structured blueprint if confidence >= 0.4 (cache hit), or raw evidence chunks for agent extraction on cache miss.',
    inputShape,
    async (args) => {
      const result = await lookupBlueprint(ctx, args.callId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
