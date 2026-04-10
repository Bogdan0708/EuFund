// ── MCP Write Server — HTTP Route ─────────────────────────────────────────
// Stateless MCP route for write operations.
// Uses WebStandardStreamableHTTPServerTransport (Web Standards API).
// Mirrors the read route pattern — one transport instance per request.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { verifyMcpToken, McpAuthError } from '@/lib/ai/agent/mcp/auth'
import { buildServiceContext } from '@/lib/ai/agent/mcp/context'
import { createWriteServer } from '@/lib/ai/agent/mcp/write'
import { ServiceError } from '@/lib/ai/agent/services/errors'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  let payload
  try {
    payload = await verifyMcpToken(req.headers.get('authorization'))
  } catch (err) {
    if (err instanceof McpAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Service context ────────────────────────────────────────────────────
  const ctx = buildServiceContext(payload, requestId)

  // ── 3. Build transport + server (stateless, one per request) ──────────────
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — no session ID needed for simple request/response
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const server = createWriteServer(ctx)

  try {
    await server.connect(transport)
    return await transport.handleRequest(req)
  } catch (err) {
    if (err instanceof ServiceError) {
      logger.warn({ requestId, err: err.message, code: err.code }, 'mcp:write service error')
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.httpStatus },
      )
    }

    logger.error({ requestId, err }, 'mcp:write unexpected error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    // Clean up transport after each request (stateless pattern)
    await transport.close().catch(() => {})
  }
}
