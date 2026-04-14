import { describe, it, expect } from 'vitest'

describe('Template interpolation', () => {
  it('interpolates all variables', async () => {
    const { interpolate } = await import('@/lib/compliance/interpolate')
    const result = interpolate(
      'Subsemnatul {{orgName}}, CUI {{cui}}, declar...',
      { orgName: 'SC Test SRL', cui: 'RO12345678' },
    )
    expect(result).toBe('Subsemnatul SC Test SRL, CUI RO12345678, declar...')
  })

  it('leaves unmatched variables as [___]', async () => {
    const { interpolate } = await import('@/lib/compliance/interpolate')
    const result = interpolate(
      'Semnătura: {{signature}}',
      {},
    )
    expect(result).toBe('Semnătura: [___]')
  })

  it('slugifies titles for deterministic IDs', async () => {
    const { slugify } = await import('@/lib/compliance/interpolate')
    expect(slugify('Declarație privind ajutoarele de minimis')).toBe('declaratie-privind-ajutoarele-de-minimis')
  })
})

describe('Form templates', () => {
  it('exports an array of FormTemplate objects', async () => {
    const { FORM_TEMPLATES } = await import('@/lib/compliance/form-templates')
    expect(Array.isArray(FORM_TEMPLATES)).toBe(true)
    expect(FORM_TEMPLATES.length).toBeGreaterThan(0)
    for (const tpl of FORM_TEMPLATES) {
      expect(tpl.templateId).toMatch(/^tpl-/)
      expect(tpl.version).toBeTruthy()
      expect(tpl.bodyTemplate).toContain('{{')
      expect(tpl.variables.length).toBeGreaterThan(0)
    }
  })

  it('all templates have unique IDs', async () => {
    const { FORM_TEMPLATES } = await import('@/lib/compliance/form-templates')
    const ids = FORM_TEMPLATES.map(t => t.templateId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('General requirements', () => {
  it('exports an array of requirement entries', async () => {
    const { GENERAL_REQUIREMENTS } = await import('@/lib/compliance/general-requirements')
    expect(Array.isArray(GENERAL_REQUIREMENTS)).toBe(true)
    expect(GENERAL_REQUIREMENTS.length).toBeGreaterThanOrEqual(4)
    for (const req of GENERAL_REQUIREMENTS) {
      expect(req.templateId).toMatch(/^tpl-/)
      expect(req.title).toBeTruthy()
    }
  })

  it('every general requirement references a valid template', async () => {
    const { GENERAL_REQUIREMENTS } = await import('@/lib/compliance/general-requirements')
    const { FORM_TEMPLATES } = await import('@/lib/compliance/form-templates')
    const templateIds = new Set(FORM_TEMPLATES.map(t => t.templateId))
    for (const req of GENERAL_REQUIREMENTS) {
      expect(templateIds.has(req.templateId)).toBe(true)
    }
  })
})
