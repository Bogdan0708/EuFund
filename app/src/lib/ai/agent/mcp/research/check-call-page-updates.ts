// ── MCP Handler: check_call_page_updates ──────────────────────────────────
// Registers the check_call_page_updates tool on the research MCP server.
// Delegates business logic to the freshness service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkCallPageUpdates } from '../../services/freshness'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  callId: z.string().min(1),
  cachedBlueprintHash: z.string().min(1),
}

export function registerCheckCallPageUpdates(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'check_call_page_updates',
    'Compare a previously computed blueprint hash against the currently stored blueprint in the database. Returns whether the blueprint has changed, the new hash, and a short diff summary. No external network call — pure DB comparison.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await checkCallPageUpdates(ctx, args.callId, args.cachedBlueprintHash)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
