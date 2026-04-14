import { describe, it, expect } from 'vitest'
import { runPostBuildQA } from '@/lib/ai/orchestrator/qa'
import type { SectionResult, SectionSpec } from '@/lib/ai/orchestrator/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSpec(overrides: Partial<SectionSpec>): SectionSpec {
  return {
    id: 'section',
    title: 'Section',
    description: 'A section',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
    ...overrides,
  }
}

function makeSection(overrides: Partial<SectionResult>): SectionResult {
  // Use a unique content default so sections don't accidentally trip duplicate detection
  const uid = overrides.id ?? 'section'
  return {
    id: 'section',
    title: 'Section',
    content: `Content for section ${uid}: ` + uid.repeat(30), // > 200 chars, unique per id
    order: 1,
    source: 'generated',
    state: 'draft',
    currentVersion: 1,
    versionCount: 1,
    contentHash: '',
    lastStateChangeAt: '2026-04-05T00:00:00Z',
    lastStateChangeBy: null,
    metadata: {
      model: 'gpt-4',
      provider: 'openai',
      tokensIn: 100,
      tokensOut: 200,
      latencyMs: 300,
      retryCount: 0,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      checksum: 'abc',
    },
    ...overrides,
  }
}

const GOOD_CONTENT = 'This is a well-written section with plenty of content to satisfy the minimum length requirement. '.repeat(4)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runPostBuildQA', () => {
  it('passes when all mandatory sections are present and valid', () => {
    const specs = [
      makeSpec({ id: 'context', mandatory: true }),
      makeSpec({ id: 'obiective', mandatory: true }),
    ]
    // Content must differ in first 100 chars to avoid duplicate detection
    const sections = [
      makeSection({ id: 'context', content: 'Context section: descrierea contextului socio-economic si justificarea proiectului pe baza analizei. '.repeat(3) }),
      makeSection({ id: 'obiective', content: 'Obiective SMART: scopul general al proiectului este imbunatatirea capacitatii administrative locale. '.repeat(3) }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.passed).toBe(true)
    expect(result.missingSections).toHaveLength(0)
    expect(result.failedSections).toHaveLength(0)
    expect(result.placeholderSections).toHaveLength(0)
    expect(result.truncatedSections).toHaveLength(0)
    expect(result.duplicateSections).toHaveLength(0)
  })

  it('fails when mandatory sections are missing', () => {
    const specs = [
      makeSpec({ id: 'context', mandatory: true }),
      makeSpec({ id: 'obiective', mandatory: true }),
      makeSpec({ id: 'metodologie', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 'context', content: GOOD_CONTENT }),
      // obiective and metodologie are missing
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.passed).toBe(false)
    expect(result.missingSections).toContain('obiective')
    expect(result.missingSections).toContain('metodologie')
    expect(result.missingSections).not.toContain('context')
  })

  it('does not report missing non-mandatory sections', () => {
    const specs = [
      makeSpec({ id: 'context', mandatory: true }),
      makeSpec({ id: 'riscuri', mandatory: false }),
    ]
    const sections = [
      makeSection({ id: 'context', content: GOOD_CONTENT }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.passed).toBe(true)
    expect(result.missingSections).toHaveLength(0)
  })

  it('detects placeholder content with [TODO]', () => {
    const specs = [makeSpec({ id: 'context', mandatory: true })]
    const sections = [
      makeSection({ id: 'context', content: GOOD_CONTENT + ' [TODO] complete this section' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.placeholderSections).toContain('context')
    expect(result.warnings.some((w) => w.includes('Placeholder'))).toBe(true)
  })

  it('detects placeholder content with [TBD]', () => {
    const specs = [makeSpec({ id: 'context', mandatory: true })]
    const sections = [
      makeSection({ id: 'context', content: GOOD_CONTENT + ' [TBD]' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.placeholderSections).toContain('context')
  })

  it('detects placeholder content with [Generation failed]', () => {
    const specs = [makeSpec({ id: 'context', mandatory: true })]
    const sections = [
      makeSection({ id: 'context', content: '[Generation failed] - unable to produce content' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.placeholderSections).toContain('context')
  })

  it('detects truncated sections (< 200 chars), skipping failed ones', () => {
    const specs = [
      makeSpec({ id: 'context', mandatory: true }),
      makeSpec({ id: 'obiective', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 'context', content: 'Short.' }), // < 200 chars
      makeSection({ id: 'obiective', content: 'Short.', source: 'failed' }), // failed — should be excluded
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.truncatedSections).toContain('context')
    expect(result.truncatedSections).not.toContain('obiective') // failed, skipped
  })

  it('detects failed sections', () => {
    const specs = [makeSpec({ id: 'context', mandatory: true })]
    const sections = [
      makeSection({ id: 'context', content: GOOD_CONTENT, source: 'failed' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.failedSections).toContain('context')
    expect(result.warnings.some((w) => w.includes('failed to generate'))).toBe(true)
  })

  it('detects duplicate sections by first-100-char similarity', () => {
    const prefix = 'X'.repeat(100) // identical first 100 chars
    const specs = [
      makeSpec({ id: 's1', mandatory: true }),
      makeSpec({ id: 's2', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 's1', content: prefix + ' different suffix here' }),
      makeSection({ id: 's2', content: prefix + ' another different suffix' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.duplicateSections).toContain('s1')
    expect(result.duplicateSections).toContain('s2')
    // Duplicate sections cause failure
    expect(result.passed).toBe(false)
  })

  it('does not flag sections with different content as duplicates', () => {
    const specs = [
      makeSpec({ id: 's1', mandatory: true }),
      makeSpec({ id: 's2', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 's1', content: GOOD_CONTENT }),
      makeSection({ id: 's2', content: 'B'.repeat(250) }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.duplicateSections).toHaveLength(0)
  })

  it('sets budgetConsistent=true when EUR amount in buget appears in rezumat', () => {
    const specs = [
      makeSpec({ id: 'buget', mandatory: true }),
      makeSpec({ id: 'rezumat', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 'buget', content: GOOD_CONTENT + ' Bugetul total este de 500.000 EUR pentru implementare.' }),
      makeSection({ id: 'rezumat', content: GOOD_CONTENT + ' Proiectul are un buget de 500.000 EUR.' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.budgetConsistent).toBe(true)
  })

  it('sets budgetConsistent=false when EUR amount in buget is absent from rezumat', () => {
    const specs = [
      makeSpec({ id: 'buget', mandatory: true }),
      makeSpec({ id: 'rezumat', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 'buget', content: GOOD_CONTENT + ' Bugetul total este de 750.000 EUR.' }),
      makeSection({ id: 'rezumat', content: GOOD_CONTENT + ' Proiectul are un buget substantial.' }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.budgetConsistent).toBe(false)
    expect(result.warnings.some((w) => w.includes('Budget amount'))).toBe(true)
  })

  it('sets budgetConsistent=null when buget section is missing', () => {
    const specs = [makeSpec({ id: 'rezumat', mandatory: true })]
    const sections = [makeSection({ id: 'rezumat', content: GOOD_CONTENT })]
    const result = runPostBuildQA(sections, specs)
    expect(result.budgetConsistent).toBeNull()
  })

  it('sets budgetConsistent=null when rezumat section is missing', () => {
    const specs = [makeSpec({ id: 'buget', mandatory: true })]
    const sections = [makeSection({ id: 'buget', content: GOOD_CONTENT + ' Budget: 200.000 EUR.' })]
    const result = runPostBuildQA(sections, specs)
    expect(result.budgetConsistent).toBeNull()
  })

  it('sets budgetConsistent=null when no EUR amount found in buget', () => {
    const specs = [
      makeSpec({ id: 'buget', mandatory: true }),
      makeSpec({ id: 'rezumat', mandatory: true }),
    ]
    const sections = [
      makeSection({ id: 'buget', content: GOOD_CONTENT + ' The budget is substantial.' }),
      makeSection({ id: 'rezumat', content: GOOD_CONTENT }),
    ]
    const result = runPostBuildQA(sections, specs)
    expect(result.budgetConsistent).toBeNull()
  })
})
