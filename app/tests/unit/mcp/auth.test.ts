import { describe, it, expect, beforeAll } from 'vitest'
import { signMcpToken, verifyMcpToken, McpAuthError } from '@/lib/ai/agent/mcp/auth'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long'

beforeAll(() => {
  process.env.MCP_TOKEN_SECRET = TEST_SECRET
})

describe('MCP Auth — signMcpToken / verifyMcpToken', () => {
  it('signs and verifies a valid token (roundtrip)', async () => {
    const payload = {
      userId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
    }

    const token = await signMcpToken(payload)
    expect(typeof token).toBe('string')
    expect(token.split('.').length).toBe(3) // valid JWT structure

    const verified = await verifyMcpToken(`Bearer ${token}`)

    expect(verified.userId).toBe(payload.userId)
    expect(verified.sessionId).toBe(payload.sessionId)
    expect(verified.organizationId).toBe(payload.organizationId)
    expect(verified.projectId).toBeUndefined()
  })

  it('includes optional projectId when provided', async () => {
    const payload = {
      userId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      projectId: '44444444-4444-4444-8444-444444444444',
    }

    const token = await signMcpToken(payload)
    const verified = await verifyMcpToken(`Bearer ${token}`)

    expect(verified.projectId).toBe(payload.projectId)
  })

  it('rejects null Authorization header', async () => {
    await expect(verifyMcpToken(null)).rejects.toThrow(McpAuthError)
    await expect(verifyMcpToken(null)).rejects.toThrow('Missing Authorization header')
  })

  it('rejects non-Bearer token scheme', async () => {
    await expect(verifyMcpToken('Basic abc123')).rejects.toThrow(McpAuthError)
    await expect(verifyMcpToken('Basic abc123')).rejects.toThrow('Bearer scheme')
  })

  it('rejects a tampered token', async () => {
    const payload = {
      userId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
    }

    const token = await signMcpToken(payload)
    const tampered = token + 'x'

    await expect(verifyMcpToken(`Bearer ${tampered}`)).rejects.toThrow(McpAuthError)
  })
})
