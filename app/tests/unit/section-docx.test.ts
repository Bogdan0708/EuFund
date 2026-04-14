import { describe, it, expect } from 'vitest'

describe('section-docx', () => {
  it('generates a valid DOCX buffer for a single section', async () => {
    const { generateSectionDocx } = await import('@/lib/export/section-docx')
    const buffer = generateSectionDocx({
      title: 'Rezumat Executiv',
      content: 'Proiectul nostru vizează...\n\nObiectivele sunt...',
      order: 1,
    })
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(100)
    // PizZip DOCX starts with PK signature
    expect(buffer[0]).toBe(0x50) // 'P'
    expect(buffer[1]).toBe(0x4b) // 'K'
  })

  it('generates a valid DOCX buffer for a form', async () => {
    const { generateFormDocx } = await import('@/lib/export/section-docx')
    const buffer = generateFormDocx({
      title: 'Declarație GDPR',
      content: 'Subsemnatul Test SRL, CUI RO123...',
    })
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(100)
    expect(buffer[0]).toBe(0x50)
    expect(buffer[1]).toBe(0x4b)
  })

  it('builds storage path with slugified title', async () => {
    const { buildSectionStoragePath } = await import('@/lib/export/section-docx')
    const path = buildSectionStoragePath('project-123', 1, 'Rezumat Executiv')
    expect(path).toBe('projects/project-123/propunere/01-rezumat-executiv.docx')
  })

  it('builds form storage path with scope', async () => {
    const { buildFormStoragePath } = await import('@/lib/export/section-docx')
    expect(buildFormStoragePath('project-123', 'general', 'Declarație GDPR'))
      .toBe('projects/project-123/formulare/generale/declaratie-gdpr.docx')
    expect(buildFormStoragePath('project-123', 'call_specific', 'Declarație minimis'))
      .toBe('projects/project-123/formulare/apel/declaratie-minimis.docx')
  })
})
