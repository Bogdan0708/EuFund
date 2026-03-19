import { describe, it, expect } from 'vitest'

describe('Funding call consolidation', () => {
  it('callsForProposals has ecPortalFields for EC data', async () => {
    const { callsForProposals } = await import('@/lib/db/schema')
    expect(callsForProposals.ecExternalId).toBeDefined()
    expect(callsForProposals.ecTopics).toBeDefined()
  })
})
