// ── MCP Handler: approve_revision ─────────────────────────────────────────
// Registers the approve_revision tool on the write MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { approveSection } from '../../services/sections'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  sectionKey: z.string().min(1),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerApproveRevision(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'approve_revision',
    'Set a section status to accepted, copying content to acceptedContent. If already accepted, returns current state (no-op). Enforces concurrency guard via expectedStateVersion.',
    inputShape,
    async (args) => {
      try {
        const result = await approveSection(ctx, {
          sessionId: args.sessionId,
          sectionKey: args.sectionKey,
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
