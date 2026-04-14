import { describe, it, expect } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

describe('ValidationError', () => {
  it('constructs without policyCode (backwards-compatible 2-arg form)', () => {
    const err = new ValidationError('sectionKey', 'Section key required')
    expect(err.field).toBe('sectionKey')
    expect(err.message).toBe('Section key required')
    expect(err.policyCode).toBeUndefined()
    expect(err.code).toBe('VALIDATION')
  })

  it('constructs with explicit policyCode (new 3-arg form)', () => {
    const err = new ValidationError(
      'outlineFrozen',
      'Outline must be frozen first',
      'POLICY_OUTLINE_NOT_FROZEN',
    )
    expect(err.field).toBe('outlineFrozen')
    expect(err.message).toBe('Outline must be frozen first')
    expect(err.policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    expect(err.code).toBe('VALIDATION')
  })

  it('name is ValidationError on both forms', () => {
    expect(new ValidationError('f', 'm').name).toBe('ValidationError')
    expect(new ValidationError('f', 'm', 'POLICY_X').name).toBe('ValidationError')
  })
})
