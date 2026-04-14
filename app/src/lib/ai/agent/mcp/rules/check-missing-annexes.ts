// ── MCP Handler: check_missing_annexes ────────────────────────────────────
// Registers the check_missing_annexes tool on the rules MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkMissingAnnexes } from '../../services/application'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

export const inputShape = {
  sessionId: z.string().uuid(),
}

export const inputSchema = z.object(inputShape)

export function registerCheckMissingAnnexes(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'check_missing_annexes',
    'Check which mandatory annexes from the call blueprint are referenced in section content and which are missing. Returns required, uploaded (mentioned), and missing annex lists. Sessions with no blueprint return empty lists. No LLM calls.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await checkMissingAnnexes(ctx, args.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
