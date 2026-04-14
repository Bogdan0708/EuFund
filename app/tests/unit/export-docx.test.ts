import { describe, it, expect } from 'vitest'

describe('DOCX Export', () => {
  it('generates a buffer from project sections', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections = [
      { title: 'Rezumat proiect', content: 'Test project summary', order: 1, source: 'generated' as const },
      { title: 'Context și justificare', content: 'Test context', order: 2, source: 'generated' as const },
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test Project', program: 'PNRR' })
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('sorts sections by order', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections = [
      { title: 'Second', content: 'B', order: 2, source: 'generated' as const },
      { title: 'First', content: 'A', order: 1, source: 'generated' as const },
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test' })
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('escapes XML special characters', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections = [
      { title: 'Test & <Special>', content: 'Content with "quotes" & <tags>', order: 1, source: 'generated' as const },
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test & Project' })
    expect(buffer.length).toBeGreaterThan(0)
  })
})
