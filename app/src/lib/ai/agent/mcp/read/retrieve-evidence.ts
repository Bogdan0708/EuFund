// ── MCP Handler: retrieve_evidence ────────────────────────────────────────
// Registers the retrieve_evidence tool on the read MCP server.
// Delegates business logic to the evidence service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { retrieveEvidence } from '../../services/evidence'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

const inputShape = {
  callId: z.string().min(1),
  query: z.string().optional(),
  maxChunks: z.number().int().min(1).max(50).optional(),
}

export function registerRetrieveEvidence(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'retrieve_evidence',
    'Retrieve evidence chunks for a specific EU funding call from the knowledge base. Returns ranked chunks ordered by document type priority (ghid > anexa > cerere > legislation) and semantic score.',
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await retrieveEvidence(ctx, args.callId, {
        query: args.query,
        maxChunks: args.maxChunks,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
