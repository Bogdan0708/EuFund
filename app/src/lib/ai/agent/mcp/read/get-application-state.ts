// ── MCP Handler: get_application_state ────────────────────────────────────
// Registers the get_application_state tool on the read MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getApplicationState } from '../../services/application'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

export const inputShape = {
  sessionId: z.string().uuid(),
}

export const inputSchema = z.object(inputShape)

export function registerGetApplicationState(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_application_state',
    'Load the full application state for an agent session. Verifies ownership — only the session owner can retrieve it. Returns phase, status, selected call, eligibility decision, section list, and state version.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await getApplicationState(ctx, args.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
