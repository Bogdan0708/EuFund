// ── MCP Handler: get_document_content ─────────────────────────────────────
// Registers the get_document_content tool on the read MCP server. Delegates
// business logic to the documents service — this file owns only the MCP
// envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getDocumentContent } from '../../services/documents'
import type { ServiceContext } from '../../services/types'
import { withMcpErrorMapping } from '../tool-error'

export const inputShape = {
  fileId: z.string().uuid(),
  maxChars: z.number().int().min(500).max(50_000).optional(),
}

export const inputSchema = z.object(inputShape)

const TOOL_DESCRIPTION =
  'Fetch extracted text for an uploaded document by file ID. Returns up to maxChars characters of the ocr_text column (default 8000, valid range 500-50000). Call AFTER list_uploaded_documents to read files the user has attached. Returns empty text when the document has not been indexed (e.g., scanned PDF with no text layer, or a legacy .doc file). The `truncated` field indicates whether text was cut off at maxChars.'

export function registerGetDocumentContent(
  server: McpServer,
  ctx: ServiceContext,
): void {
  server.tool(
    'get_document_content',
    TOOL_DESCRIPTION,
    inputShape,
    withMcpErrorMapping(async (args) => {
      const result = await getDocumentContent(ctx, args.fileId, {
        maxChars: args.maxChars,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }),
  )
}
