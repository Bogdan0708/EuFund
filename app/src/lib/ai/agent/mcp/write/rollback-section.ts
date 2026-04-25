// ── MCP Handler: rollback_section ─────────────────────────────────────────
// Registers the rollback_section tool on the write MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { rollbackSection } from '../../services/sections'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'

export const inputShape = {
  sectionKey: z.string().min(1),
  targetVersion: z.number().int(),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerRollbackSection(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'rollback_section',
    'Restore a section to a previous version by version number. Replaces section content with the historical version content and sets status to draft. Returns content, restoredVersion, and newStateVersion.',
    inputShape,
    async (args) => {
      try {
        requireSession(ctx)
        const result = await rollbackSection(ctx, {
          sessionId: ctx.sessionId,
          sectionKey: args.sectionKey,
          targetVersion: args.targetVersion,
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
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: err.policyCode ?? `VALIDATION:${err.field}`, field: err.field }) }],
            isError: true,
          }
        }
        throw err
      }
    },
  )
}
