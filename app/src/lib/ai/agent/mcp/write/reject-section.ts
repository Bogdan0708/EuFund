// ── MCP Handler: reject_section ───────────────────────────────────────────
// Registers the reject_section tool on the write MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { rejectSection } from '../../services/sections'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'

export const inputShape = {
  sectionKey: z.string().min(1),
  reason: z.string().min(1),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerRejectSection(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'reject_section',
    'Reject a section with a required reason string. Valid from draft, needs_review, or same-reason rejected (no-op). Different-reason re-reject is forbidden to prevent rejection metadata churn. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    inputShape,
    async (args) => {
      try {
        requireSession(ctx)
        const result = await rejectSection(ctx, {
          sessionId: ctx.sessionId,
          sectionKey: args.sectionKey,
          reason: args.reason,
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
