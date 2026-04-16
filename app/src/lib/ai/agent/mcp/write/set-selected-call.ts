// ── MCP Handler: set_selected_call ────────────────────────────────────────
// Registers the set_selected_call tool on the write MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { setSelectedCall } from '../../services/application'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  callId: z.string().min(1),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerSetSelectedCall(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'set_selected_call',
    "Set the session's selected funding call. Requires the session to be active and the outline not yet frozen. Idempotent if the same callId is already selected. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.",
    inputShape,
    async (args) => {
      try {
        const result = await setSelectedCall(ctx, {
          sessionId: args.sessionId,
          callId: args.callId,
          expectedStateVersion: args.expectedStateVersion,
        })
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'CONCURRENCY', expected: err.expected, actual: err.actual }) }],
            isError: true,
          }
        }
        if (err instanceof ValidationError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: err.policyCode ?? `VALIDATION:${err.field}`, field: err.field }) }],
            isError: true,
          }
        }
        if (err instanceof NotFoundError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'NOT_FOUND' }) }],
            isError: true,
          }
        }
        throw err
      }
    },
  )
}
