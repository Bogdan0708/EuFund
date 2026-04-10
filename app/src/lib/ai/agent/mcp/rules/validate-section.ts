// ── MCP Handler: validate_section ─────────────────────────────────────────
// Registers the validate_section tool on the rules MCP server.
// Delegates business logic to the sections service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { validateSection } from '../../services/sections'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  sessionId: z.string().uuid(),
  sectionKey: z.string(),
}

export function registerValidateSection(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'validate_section',
    'Validate a generated section for quality issues using deterministic rules — checks for empty content, insufficient length, placeholder text, and repeated sentences. Returns a list of issues with severity, a quality score (0-100), and a recommended section status. No LLM calls.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await validateSection(ctx, args.sessionId, args.sectionKey)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
