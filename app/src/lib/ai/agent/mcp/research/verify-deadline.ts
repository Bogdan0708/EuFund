// ── MCP Handler: verify_deadline ──────────────────────────────────────────
// Registers the verify_deadline tool on the research MCP server.
// Delegates business logic to the freshness service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { verifyDeadline } from '../../services/freshness'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  callId: z.string().min(1),
}

export function registerVerifyDeadline(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'verify_deadline',
    'Look up the cached deadline for an EU funding call and calculate how many days remain. Uses only stored blueprint data — no external network call. Returns deadline, open/closed status, and daysRemaining. Use refresh_call_freshness first if up-to-date status is required.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await verifyDeadline(ctx, args.callId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
