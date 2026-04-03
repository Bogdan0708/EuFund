import { describe, it, expect } from 'vitest'
import { MODEL_CONFIGS, SECTION_MODEL_ROUTING } from '@/lib/ai/providers/types'

describe('Provider types', () => {
  it('MODEL_CONFIGS has all expected models', () => {
    expect(MODEL_CONFIGS['claude-opus-4-6']).toBeDefined()
    expect(MODEL_CONFIGS['claude-sonnet-4-6']).toBeDefined()
    expect(MODEL_CONFIGS['gpt-5.4']).toBeDefined()
    expect(MODEL_CONFIGS['gemini-2.5-flash']).toBeDefined()
    expect(MODEL_CONFIGS['sonar']).toBeDefined()
    expect(MODEL_CONFIGS['sonar-pro']).toBeDefined()
  })

  it('every model has a timeout', () => {
    for (const [name, config] of Object.entries(MODEL_CONFIGS)) {
      expect(config.timeout).toBeGreaterThan(0)
    }
  })

  it('section routing maps importance to models', () => {
    expect(SECTION_MODEL_ROUTING.critical).toBe('claude-opus-4-6')
    expect(SECTION_MODEL_ROUTING.standard).toBe('claude-sonnet-4-6')
    expect(SECTION_MODEL_ROUTING.budget).toBe('gpt-5.4')
  })
})
