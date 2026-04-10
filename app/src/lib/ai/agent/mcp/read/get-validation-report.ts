// ── MCP Handler: get_validation_report ────────────────────────────────────
// Registers the get_validation_report tool on the read MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getValidationReport } from '../../services/application'
import type { ServiceContext } from '../../services/types'

const inputShape = {
  sessionId: z.string().uuid(),
}

export function registerGetValidationReport(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_validation_report',
    'Get a read-only validation summary for an agent session. Returns counts of accepted, draft, and missing sections plus eligibility blockers. The full deterministic rules check runs on the rules server. Verifies session ownership.',
    inputShape,
    async (args) => {
      const result = await getValidationReport(ctx, args.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
