import { describe, it, expect } from 'vitest'

describe('Design system components export', () => {
  it('exports DsCard', async () => {
    const mod = await import('@/components/ui/ds-card')
    expect(mod.DsCard).toBeDefined()
  })

  it('exports DsButton', async () => {
    const mod = await import('@/components/ui/ds-button')
    expect(mod.DsButton).toBeDefined()
  })

  it('exports DsInput', async () => {
    const mod = await import('@/components/ui/ds-input')
    expect(mod.DsInput).toBeDefined()
  })

  it('exports DsChip', async () => {
    const mod = await import('@/components/ui/ds-chip')
    expect(mod.DsChip).toBeDefined()
  })

  it('exports Icon', async () => {
    const mod = await import('@/components/ui/ds-icon')
    expect(mod.Icon).toBeDefined()
  })

  it('exports StatusBadge', async () => {
    const mod = await import('@/components/ui/status-badge')
    expect(mod.StatusBadge).toBeDefined()
  })
})
