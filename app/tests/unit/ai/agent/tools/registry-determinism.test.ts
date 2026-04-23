import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { getToolsForPhase } from '@/lib/ai/agent/tools/registry'
import { zodToJsonSchema } from '@/lib/ai/agent/utils'
import '@/lib/ai/agent/tools/index' // ensure tools self-register
import { deriveIdentityKey } from '@/lib/ai/providers/cache-key'
import type { ToolSchema } from '@/lib/ai/providers/types'

type ToolSchemaShape = ToolSchema

function buildToolSchemas(phase: Parameters<typeof getToolsForPhase>[0]): ToolSchemaShape[] {
  return getToolsForPhase(phase).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema),
    },
  }))
}

function hashToolSchemas(schemas: ToolSchemaShape[]): string {
  // canonical JSON via sorted keys recursively — mirrors what the identity key
  // derivation does internally. Any ordering drift in parameters would alter
  // this hash.
  const canon = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(canon)
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x as Record<string, unknown>).sort()) {
        out[k] = canon((x as Record<string, unknown>)[k])
      }
      return out
    }
    return x
  }
  return createHash('sha256').update(JSON.stringify(canon(schemas))).digest('hex')
}

describe('tool registry — determinism per phase', () => {
  const phases = ['discovery', 'research', 'structuring', 'drafting', 'review'] as const

  it.each(phases)('getToolsForPhase(%s) returns the same tool NAME order on repeat calls', (phase) => {
    const first = getToolsForPhase(phase).map(t => t.name)
    const second = getToolsForPhase(phase).map(t => t.name)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  })

  it.each(phases)('tool SCHEMAS (zodToJsonSchema output) are canonically stable across repeat builds for phase %s', (phase) => {
    const schemas1 = buildToolSchemas(phase)
    const schemas2 = buildToolSchemas(phase)
    expect(hashToolSchemas(schemas1)).toBe(hashToolSchemas(schemas2))
  })

  it.each(phases)('tool SCHEMAS preserve raw insertion-order bytes across repeat builds for phase %s (literal wire-bytes stability)', (phase) => {
    // Anthropic SDK serializes with insertion order; this check catches a drift
    // canonical hashing would mask. If zodToJsonSchema returns keys in a new
    // order on a second call, the last-tool cache_control byte-prefix shifts
    // and cache hits vanish even though identityKey would still match.
    const raw1 = JSON.stringify(buildToolSchemas(phase))
    const raw2 = JSON.stringify(buildToolSchemas(phase))
    expect(raw1).toBe(raw2)
  })

  it.each(phases)('identityKey from (anthropic, claude-opus-4-6, system-sentinel, tools-for-%s) is stable across repeat derivations', (phase) => {
    const tools = buildToolSchemas(phase)
    const system = '<sentinel-stable-system>'
    const k1 = deriveIdentityKey({ provider: 'anthropic', model: 'claude-opus-4-6', system, tools })
    const k2 = deriveIdentityKey({ provider: 'anthropic', model: 'claude-opus-4-6', system, tools })
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('getToolsForPhase returns no duplicate tool names within a phase', () => {
    for (const phase of phases) {
      const names = getToolsForPhase(phase).map(t => t.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })
})
