import { describe, it, expect } from 'vitest'
import type { SectionResult } from '@/lib/ai/orchestrator/types'

const makeSection = (id: string, title: string, content: string, order: number): SectionResult => ({
  id,
  title,
  content,
  order,
  source: 'generated',
  metadata: { model: 'gpt-4o', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-02T00:00:00Z', checksum: 'abc' },
})

describe('DOCX Export', () => {
  it('generates a buffer from project sections', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections: SectionResult[] = [
      makeSection('sec-1', 'Rezumat proiect', 'Test project summary', 1),
      makeSection('sec-2', 'Context și justificare', 'Test context', 2),
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test Project', program: 'PNRR' })
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('sorts sections by order', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections: SectionResult[] = [
      makeSection('sec-2', 'Second', 'B', 2),
      makeSection('sec-1', 'First', 'A', 1),
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test' })
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('escapes XML special characters', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections: SectionResult[] = [
      makeSection('sec-1', 'Test & <Special>', 'Content with "quotes" & <tags>', 1),
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test & Project' })
    expect(buffer.length).toBeGreaterThan(0)
  })
})
