// ── MCP Handler: get_application_state ────────────────────────────────────
// Registers the get_application_state tool on the read MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getApplicationState } from '../../services/application'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

// sessionId is NOT a model-supplied input — it's implicit on the runtime
// context. The model was never handed a sessionId and shouldn't guess one.
export const inputShape = {}

export const inputSchema = z.object(inputShape)

export function registerGetApplicationState(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_application_state',
    'Load the full application state for the current agent session. Returns phase, status, selected call, eligibility decision, section list, and state version. The runtime scopes this call to your session automatically.',
    inputShape,
    withMcpErrorMapping(async () => {
      requireSession(ctx)
      const result = await getApplicationState(ctx, ctx.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
