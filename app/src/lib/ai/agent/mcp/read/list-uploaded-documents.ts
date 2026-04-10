// ── MCP Handler: list_uploaded_documents ──────────────────────────────────
// Registers the list_uploaded_documents tool on the read MCP server.
// Delegates business logic to the projects service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listUploadedDocuments } from '../../services/projects'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

export const inputShape = {
  projectId: z.string().uuid(),
}

export const inputSchema = z.object(inputShape)

export function registerListUploadedDocuments(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'list_uploaded_documents',
    'List documents uploaded for a project. Returns file metadata including name, MIME type, size, and upload time. Currently returns an empty array while the document storage integration is pending.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await listUploadedDocuments(ctx, args.projectId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
