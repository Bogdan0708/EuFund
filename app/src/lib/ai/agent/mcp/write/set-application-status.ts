// ── MCP Handler: set_application_status ───────────────────────────────────
// Registers the set_application_status tool on the write MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { setApplicationStatus } from '../../services/application'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  status: z.enum(['paused', 'completed']),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerSetApplicationStatus(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'set_application_status',
    'Update the status of an agent session to paused or completed. Setting to the current status is a no-op (idempotent). Enforces concurrency guard via expectedStateVersion.',
    inputShape,
    async (args) => {
      try {
        const result = await setApplicationStatus(ctx, {
          sessionId: args.sessionId,
          status: args.status,
          expectedStateVersion: args.expectedStateVersion,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'CONCURRENCY', expected: err.expected, actual: err.actual }) }],
            isError: true,
          }
        }
        if (err instanceof NotFoundError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'NOT_FOUND' }) }],
            isError: true,
          }
        }
        if (err instanceof ValidationError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'VALIDATION', field: err.field }) }],
            isError: true,
          }
        }
        throw err
      }
    },
  )
}
