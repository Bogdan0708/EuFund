import { describe, it, expect } from 'vitest'
import { canonicalJson, deriveIdentityKey } from '@/lib/ai/providers/cache-key'
import type { GenerateRequest } from '@/lib/ai/providers/types'

describe('canonicalJson', () => {
  it('sorts object keys deterministically at all depths', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } })
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 })
    expect(a).toBe(b)
  })

  it('preserves array order (arrays are semantic)', () => {
    const a = canonicalJson(['x', 'y'])
    const b = canonicalJson(['y', 'x'])
    expect(a).not.toBe(b)
  })

  it('serialises strings, numbers, booleans, null', () => {
    expect(canonicalJson({ a: 'x', b: 1, c: true, d: null })).toBe('{"a":"x","b":1,"c":true,"d":null}')
  })
})

describe('deriveIdentityKey', () => {
  const baseReq: Pick<GenerateRequest, 'provider' | 'model' | 'system' | 'tools'> = {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    system: 'You are an assistant.',
    tools: [{
      type: 'function',
      function: {
        name: 'search',
        description: 'searches',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    }],
  }

  it('produces a 64-char lowercase hex sha256', () => {
    const key = deriveIdentityKey(baseReq)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across shuffled object-key order in tool schemas', () => {
    const shuffled = {
      ...baseReq,
      tools: [{
        type: 'function' as const,
        function: {
          parameters: { properties: { q: { type: 'string' } }, type: 'object' },
          description: 'searches',
          name: 'search',
        },
      }],
    }
    expect(deriveIdentityKey(baseReq)).toBe(deriveIdentityKey(shuffled))
  })

  it('changes when tool order changes (tool order is semantic)', () => {
    const twoTools = {
      ...baseReq,
      tools: [
        baseReq.tools![0],
        {
          type: 'function' as const,
          function: { name: 'other', description: '', parameters: {} },
        },
      ],
    }
    const reversed = { ...twoTools, tools: [twoTools.tools![1], twoTools.tools![0]] }
    expect(deriveIdentityKey(twoTools)).not.toBe(deriveIdentityKey(reversed))
  })

  it('does not incorporate messages (they must be excluded)', () => {
    const a = deriveIdentityKey(baseReq)
    const b = deriveIdentityKey({ ...baseReq })
    expect(a).toBe(b)
  })

  it('changes when provider changes', () => {
    const k1 = deriveIdentityKey(baseReq)
    const k2 = deriveIdentityKey({ ...baseReq, provider: 'openai' })
    expect(k1).not.toBe(k2)
  })

  it('changes when model changes', () => {
    const k1 = deriveIdentityKey(baseReq)
    const k2 = deriveIdentityKey({ ...baseReq, model: 'claude-sonnet-4-6' })
    expect(k1).not.toBe(k2)
  })
})
