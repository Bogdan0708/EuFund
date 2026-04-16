// ── MCP Handler: save_section_draft ──────────────────────────────────────
// Registers the save_section_draft tool on the write MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation and error mapping.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { saveSectionDraft } from '../../services/sections'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  sectionKey: z.string().min(1),
  content: z.string(),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerSaveSectionDraft(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'save_section_draft',
    'Upsert a section draft by (sessionId, sectionKey). Creates or updates the section, creates a version record, and increments the session stateVersion. Enforces concurrency guard via expectedStateVersion.',
    inputShape,
    async (args) => {
      try {
        const result = await saveSectionDraft(ctx, {
          sessionId: args.sessionId,
          sectionKey: args.sectionKey,
          content: args.content,
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
