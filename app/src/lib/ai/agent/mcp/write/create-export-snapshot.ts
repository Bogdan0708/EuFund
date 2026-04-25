// ── MCP Handler: create_export_snapshot ───────────────────────────────────
// Registers the create_export_snapshot tool on the write MCP server.
// Delegates business logic to the application service — this file owns only
// the MCP envelope translation and error mapping.
//
// NOTE: This tool is NOT idempotent — each call creates a NEW snapshot.
// Callers must not retry blindly.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createExportSnapshot } from '../../services/application'
import { NotFoundError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'
import { requireSession } from '../../services/types'

const inputShape = {}

export function registerCreateExportSnapshot(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'create_export_snapshot',
    'Create a JSON export snapshot of all accepted sections for the current session. Each call creates a NEW snapshot — do not retry blindly. Returns snapshotId, format, downloadUrl, and expiresAt.',
    inputShape,
    async () => {
      try {
        requireSession(ctx)
        const result = await createExportSnapshot(ctx, ctx.sessionId)
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }
      } catch (err) {
        if (err instanceof NotFoundError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'NOT_FOUND' }) }],
            isError: true,
          }
        }
        throw err
      }
    },
  )
}
