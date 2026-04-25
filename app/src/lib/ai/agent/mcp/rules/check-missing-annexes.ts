// ── MCP Handler: check_missing_annexes ────────────────────────────────────
// Registers the check_missing_annexes tool on the rules MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkMissingAnnexes } from '../../services/application'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

// sessionId is implicit on ctx — see get-application-state.ts header.
export const inputShape = {}

export const inputSchema = z.object(inputShape)

export function registerCheckMissingAnnexes(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'check_missing_annexes',
    'Check which mandatory annexes from the call blueprint are referenced in section content and which are missing. Returns required, uploaded (mentioned), and missing annex lists. Sessions with no blueprint return empty lists. No LLM calls.',
    inputShape,
    withMcpErrorMapping(async () => {
      requireSession(ctx)
      const result = await checkMissingAnnexes(ctx, ctx.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
