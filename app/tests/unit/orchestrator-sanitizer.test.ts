import { describe, it, expect } from 'vitest'

describe('Data Anonymization', () => {
  it('redacts CIF numbers', async () => {
    const { sanitizeForAI } = await import('@/lib/ai/orchestrator/sanitizer')
    expect(sanitizeForAI('Company CIF RO12345678')).toBe('Company CIF [REDACTED_CIF]')
  })

  it('redacts IBAN numbers', async () => {
    const { sanitizeForAI } = await import('@/lib/ai/orchestrator/sanitizer')
    expect(sanitizeForAI('Account RO49AAAA1B31007593840000')).toBe('Account [REDACTED_IBAN]')
  })

  it('redacts CNP numbers', async () => {
    const { sanitizeForAI } = await import('@/lib/ai/orchestrator/sanitizer')
    expect(sanitizeForAI('CNP 1234567890123')).toBe('CNP [REDACTED_CNP]')
  })

  it('preserves non-sensitive text', async () => {
    const { sanitizeForAI } = await import('@/lib/ai/orchestrator/sanitizer')
    expect(sanitizeForAI('PNRR Call 4.2 budget 500000 EUR')).toBe('PNRR Call 4.2 budget 500000 EUR')
  })
})
