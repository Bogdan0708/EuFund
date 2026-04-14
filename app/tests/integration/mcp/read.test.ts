// ── MCP Read Route — Integration Test ────────────────────────────────────
// Validates the MCP SDK integrates with Next.js App Router via
// WebStandardStreamableHTTPServerTransport (stateless mode).

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { signMcpToken } from '@/lib/ai/agent/mcp/auth'

// ── Constants ──────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-mcp-secret-must-be-at-least-32-chars-long'
const BASE_URL = 'http://localhost:3000/api/mcp/read'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

// ── Mocks (hoisted before any imports) ────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([
      {
        id: 'vec-1',
        content: 'PNRR call for green energy projects in Romania.',
        score: 0.91,
        metadata: {
          callId: 'PNRR-C6-I1',
          callTitle: 'Green Energy Transition',
          program: 'PNRR',
        },
      },
      {
        id: 'vec-2',
        content: 'PEO regional development call for SMEs.',
        score: 0.85,
        metadata: {
          callId: 'PEO-2024-SME',
          callTitle: 'SME Regional Development',
          program: 'PEO',
        },
      },
    ]),
  })),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { id: 'id', callId: 'call_id', confidence: 'confidence', blueprint: 'blueprint' },
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMcpRequest(body: unknown, authHeader?: string): Request {
  return new Request(BASE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // MCP requires both content types in Accept (spec requirement)
      'accept': 'application/json, text/event-stream',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  })
}

function makeToolsCallBody(toolName: string, args: Record<string, unknown>, id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  }
}

function makeInitializeBody(id = 0) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

let validToken: string

beforeAll(async () => {
  process.env.MCP_TOKEN_SECRET = TEST_SECRET
  validToken = await signMcpToken({
    userId: USER_ID,
    sessionId: SESSION_ID,
    organizationId: ORG_ID,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/mcp/read', () => {
  // ── Auth rejection ─────────────────────────────────────────────────────

  it('rejects request with no Authorization header → 401', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    const req = makeMcpRequest(makeInitializeBody())
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/Missing Authorization header/i)
  })

  it('rejects request with invalid Bearer token → 401', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    const req = makeMcpRequest(makeInitializeBody(), 'Bearer invalid.token.here')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('rejects request with non-Bearer scheme → 401', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    const req = makeMcpRequest(makeInitializeBody(), 'Basic dXNlcjpwYXNz')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  // ── MCP protocol — initialize ─────────────────────────────────────────

  it('handles MCP initialize request → 200 with server info', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    const req = makeMcpRequest(makeInitializeBody(), `Bearer ${validToken}`)
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    // MCP JSON-RPC response shape
    expect(body).toHaveProperty('jsonrpc', '2.0')
    expect(body).toHaveProperty('id', 0)
    expect(body).toHaveProperty('result')
    expect(body.result).toHaveProperty('serverInfo')
    expect(body.result.serverInfo).toMatchObject({ name: 'eufunds-read', version: '1.0.0' })
  })

  // ── MCP protocol — tools/list ─────────────────────────────────────────

  it('lists registered tools after initialization → 200 with tool names', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    // Must initialize first, then list tools in separate stateless requests
    // Since stateless mode, we can call tools/list directly without init
    const listBody = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }

    // Initialize first to set _initialized = true on this transport
    const initReq = makeMcpRequest(makeInitializeBody(), `Bearer ${validToken}`)
    const initRes = await POST(initReq as any)
    expect(initRes.status).toBe(200)

    // In stateless mode each request is a fresh transport — so we test tools/list
    // via a fresh transport call. The stateless transport allows it without session checks.
    const listReq = makeMcpRequest(listBody, `Bearer ${validToken}`)
    const listRes = await POST(listReq as any)

    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(body).toHaveProperty('result')
    expect(body.result).toHaveProperty('tools')
    const toolNames = body.result.tools.map((t: { name: string }) => t.name)
    expect(toolNames).toContain('search_calls')
    expect(toolNames).toContain('get_call_blueprint')
    expect(toolNames).toContain('get_application_state')
  })

  // ── MCP protocol — tools/call: search_calls ───────────────────────────

  it('calls search_calls tool → 200 with matching results', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    // Step 1: initialize
    const initReq = makeMcpRequest(makeInitializeBody(), `Bearer ${validToken}`)
    await POST(initReq as any)

    // Step 2: call search_calls on a fresh stateless transport
    const callReq = makeMcpRequest(
      makeToolsCallBody('search_calls', { query: 'green energy Romania', maxResults: 5 }),
      `Bearer ${validToken}`,
    )
    const callRes = await POST(callReq as any)

    expect(callRes.status).toBe(200)
    const body = await callRes.json()
    expect(body).toHaveProperty('jsonrpc', '2.0')
    expect(body).toHaveProperty('result')
    // Tool result returns content array per MCP spec
    expect(body.result).toHaveProperty('content')
    expect(Array.isArray(body.result.content)).toBe(true)
    expect(body.result.content.length).toBeGreaterThan(0)

    // The tool serializes the service result as JSON text
    const text = body.result.content[0].text
    const parsed = JSON.parse(text)
    expect(parsed).toHaveProperty('matches')
    expect(Array.isArray(parsed.matches)).toBe(true)
    expect(parsed.matches.length).toBeGreaterThan(0)
    expect(parsed.matches[0]).toHaveProperty('callId', 'PNRR-C6-I1')
    expect(parsed.matches[0]).toHaveProperty('program', 'PNRR')
  })

  // ── MCP protocol — unknown tool ───────────────────────────────────────

  it('returns JSON-RPC error for unknown tool name', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')

    const callReq = makeMcpRequest(
      makeToolsCallBody('nonexistent_tool', { foo: 'bar' }),
      `Bearer ${validToken}`,
    )
    const callRes = await POST(callReq as any)

    // MCP returns 200 with JSON-RPC error body (not HTTP error)
    expect(callRes.status).toBe(200)
    const body = await callRes.json()
    // Either a JSON-RPC error or tool error response
    const hasError = body.error !== undefined || body.result?.isError === true
    expect(hasError).toBe(true)
  })
})
