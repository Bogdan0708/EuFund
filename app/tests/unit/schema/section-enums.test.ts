import { describe, it, expect } from 'vitest'
import { SECTION_STATUSES } from '@/lib/ai/agent/types'
import { agentSectionStatusEnum, agentSectionVersionKindEnum } from '@/lib/db/schema'

describe('section status enum sync', () => {
  it('Drizzle enum values include rejected', () => {
    expect(agentSectionStatusEnum.enumValues).toContain('rejected')
  })

  it('Drizzle enum values include stale', () => {
    expect(agentSectionStatusEnum.enumValues).toContain('stale')
  })

  it('TS SECTION_STATUSES union and Drizzle enum have the same values', () => {
    const tsValues = [...SECTION_STATUSES].sort()
    const drizzleValues = [...agentSectionStatusEnum.enumValues].sort()
    expect(tsValues).toEqual(drizzleValues)
  })
})

describe('section version kind enum sync', () => {
  it('Drizzle enum values include rollback', () => {
    expect(agentSectionVersionKindEnum.enumValues).toContain('rollback')
  })

  it('Drizzle enum values include the original 4 plus rollback', () => {
    const values = [...agentSectionVersionKindEnum.enumValues].sort()
    expect(values).toEqual(['accepted', 'draft', 'regenerated', 'rollback', 'system_rewrite'])
  })
})
