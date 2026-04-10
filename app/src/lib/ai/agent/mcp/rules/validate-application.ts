// ── MCP Handler: validate_application ─────────────────────────────────────
// Registers the validate_application tool on the rules MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { validateApplication } from '../../services/application'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  sessionId: z.string().uuid(),
}

export function registerValidateApplication(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'validate_application',
    'Run a full deterministic validation of a complete application session. Checks mandatory sections (generated and accepted), eligibility blockers, mandatory annexes referenced in content, and call data freshness. Returns pass/fail with per-issue diagnostics and a summary. No LLM calls.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await validateApplication(ctx, args.sessionId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
