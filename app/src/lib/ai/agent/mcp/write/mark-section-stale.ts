// ── MCP Handler: mark_section_stale ───────────────────────────────────────
// Registers the mark_section_stale tool on the write MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { markSectionStale } from '../../services/sections'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  sectionKey: z.string().min(1),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerMarkSectionStale(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'mark_section_stale',
    'Mark a section as stale, flagging it for regeneration. Valid from draft, needs_review, or accepted status. When demoting from accepted, the accepted snapshot is cleared and the section becomes a fresh rework candidate. Idempotent if already stale. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    inputShape,
    async (args) => {
      try {
        const result = await markSectionStale(ctx, {
          sessionId: args.sessionId,
          sectionKey: args.sectionKey,
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
