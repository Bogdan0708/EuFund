// ── MCP Handler: get_project_summary ──────────────────────────────────────
// Registers the get_project_summary tool on the read MCP server.
// Delegates business logic to the projects service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getProjectSummary } from '../../services/projects'
import type { ServiceContext } from '../../services/types'

const inputShape = {
  projectId: z.string().uuid(),
}

export function registerGetProjectSummary(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'get_project_summary',
    'Load a summary of a project including title, status, organization, and dates. Verifies ownership — only the project creator can retrieve it.',
    inputShape,
    async (args) => {
      const result = await getProjectSummary(ctx, args.projectId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
