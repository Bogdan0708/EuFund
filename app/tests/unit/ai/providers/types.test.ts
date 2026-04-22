import { describe, it, expect } from 'vitest'
import type {
  CacheOptions,
  CacheUsage,
  CacheDisabledReason,
  CacheHit,
  RouterToolCall,
  RouterMessage,
  GenerateRequest,
  GenerateResult,
} from '@/lib/ai/providers/types'

describe('router cache type shapes', () => {
  it('CacheOptions accepts the v1 breakpoint union', () => {
    const opts: CacheOptions = {
      enabled: true,
      key: 'v3:abc:drafting',
      breakpoints: ['system', 'tools'],
      ttlSeconds: 300,
    }
    expect(opts.enabled).toBe(true)
  })

  it('CacheUsage has the documented shape', () => {
    const usage: CacheUsage = {
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: 'a'.repeat(64),
      supported: true,
      reads: 100,
      writes: 0,
      hit: 'read',
      effectiveTtlSeconds: 300,
    }
    expect(usage.hit).toBe('read')
  })

  it('RouterToolCall matches OpenAI wire shape', () => {
    const tc: RouterToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: 'search_calls', arguments: '{}' },
    }
    expect(tc.type).toBe('function')
  })

  it('RouterMessage permits assistant + tool_calls', () => {
    const msg: RouterMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }],
    }
    expect(msg.role).toBe('assistant')
  })

  it('GenerateResult.cacheUsage is optional', () => {
    const result: GenerateResult = {
      content: 'ok',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    }
    expect(result.cacheUsage).toBeUndefined()
  })

  it('CacheDisabledReason enumerates the three values', () => {
    const reasons: CacheDisabledReason[] = ['global_kill_switch', 'request_disabled', 'none']
    expect(reasons).toHaveLength(3)
  })

  it('CacheHit enumerates the four values', () => {
    const hits: CacheHit[] = ['read', 'miss', 'disabled', 'unsupported']
    expect(hits).toHaveLength(4)
  })
})
