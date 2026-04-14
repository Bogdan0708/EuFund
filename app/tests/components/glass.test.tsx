import { describe, it, expect } from 'vitest'

describe('Glass components export', () => {
  it('exports all glass components', async () => {
    const glass = await import('@/components/glass')
    expect(glass.GlassCard).toBeDefined()
    expect(glass.GlassButton).toBeDefined()
    expect(glass.GlassInput).toBeDefined()
    expect(glass.GlassBadge).toBeDefined()
    expect(glass.GlassChip).toBeDefined()
    expect(glass.GlassSkeleton).toBeDefined()
    expect(glass.GlassModal).toBeDefined()
    expect(glass.GlassDropZone).toBeDefined()
  })
})
