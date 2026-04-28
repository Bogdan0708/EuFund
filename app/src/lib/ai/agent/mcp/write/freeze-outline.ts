// ── MCP Handler: freeze_outline ───────────────────────────────────────────
// Registers the freeze_outline tool on the write MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { freezeOutline } from '../../services/application'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'

export const inputShape = {
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerFreezeOutline(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'freeze_outline',
    'Freeze the application outline for the current session, moving the workflow from structuring into drafting. Requires a selected call and passing eligibility. After freeze, the call cannot change and drafting tools become available. Idempotent if outline is already frozen. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    inputShape,
    async (args) => {
      try {
        requireSession(ctx)
        const result = await freezeOutline(ctx, {
          sessionId: ctx.sessionId,
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
