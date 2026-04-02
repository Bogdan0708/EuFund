// ─── Post-Build QA ───────────────────────────────────────────────────────────

import type { SectionResult, SectionSpec, QAResult } from './types'

const PLACEHOLDER_PATTERNS = [
  /\[TODO\]/i,
  /\[TBD\]/i,
  /\[PLACEHOLDER\]/i,
  /\[INSERT\]/i,
  /\[Generation failed\]/i,
]

const MIN_CONTENT_LENGTH = 200

/**
 * Similarity between two strings based on character-level overlap.
 * Compares up to the first 100 characters of each string.
 */
function charSimilarity(a: string, b: string): number {
  const s1 = a.slice(0, 100)
  const s2 = b.slice(0, 100)
  if (s1.length === 0 && s2.length === 0) return 1
  const maxLen = Math.max(s1.length, s2.length)
  if (maxLen === 0) return 1

  // Count matching chars at each position
  let matches = 0
  const minLen = Math.min(s1.length, s2.length)
  for (let i = 0; i < minLen; i++) {
    if (s1[i] === s2[i]) matches++
  }
  return matches / maxLen
}

/**
 * Extract the first EUR monetary amount from text.
 * Accepts formats like: 500.000 EUR, EUR 1,200,000, 2.500.000 €, 1.5 mil EUR
 */
function extractEurAmount(text: string): string | null {
  // Match patterns: <number> EUR/€ or EUR/€ <number>
  const patterns = [
    /(\d[\d.,\s]*(?:\.000)?)\s*(?:EUR|€)/i,
    /(?:EUR|€)\s*(\d[\d.,\s]*(?:\.000)?)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      // Normalise: strip spaces, keep digits, dots, commas
      return match[1]?.replace(/\s/g, '') ?? null
    }
  }
  return null
}

/**
 * Run post-build QA on the generated sections.
 *
 * Checks:
 * 1. Mandatory section coverage
 * 2. Failed sections
 * 3. Placeholder detection
 * 4. Minimum content length (< 200 chars)
 * 5. Duplicate detection (first 100 chars, >80% char match)
 * 6. Budget consistency (EUR amount in buget appears in rezumat)
 *
 * `passed` = true only when missingSections and duplicateSections are both empty.
 */
export function runPostBuildQA(
  sections: SectionResult[],
  specs: SectionSpec[],
): QAResult {
  const generatedIds = new Set(sections.map((s) => s.id))

  // 1. Mandatory coverage
  const missingSections: string[] = specs
    .filter((spec) => spec.mandatory && !generatedIds.has(spec.id))
    .map((spec) => spec.id)

  // 2. Failed sections
  const failedSections: string[] = sections
    .filter((s) => s.source === 'failed')
    .map((s) => s.id)

  // 3. Placeholder detection
  const placeholderSections: string[] = sections
    .filter((s) =>
      PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(s.content)),
    )
    .map((s) => s.id)

  // 4. Min content length (skip failed sections)
  const truncatedSections: string[] = sections
    .filter(
      (s) =>
        s.source !== 'failed' && s.content.length < MIN_CONTENT_LENGTH,
    )
    .map((s) => s.id)

  // 5. Duplicate detection
  const duplicateSections: string[] = []
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const similarity = charSimilarity(
        sections[i].content,
        sections[j].content,
      )
      if (similarity > 0.8) {
        if (!duplicateSections.includes(sections[i].id)) {
          duplicateSections.push(sections[i].id)
        }
        if (!duplicateSections.includes(sections[j].id)) {
          duplicateSections.push(sections[j].id)
        }
      }
    }
  }

  // 6. Budget consistency
  let budgetConsistent: boolean | null = null
  const bugetSection = sections.find((s) => s.id === 'buget')
  const rezumatSection = sections.find((s) => s.id === 'rezumat')

  if (bugetSection && rezumatSection) {
    const eurAmount = extractEurAmount(bugetSection.content)
    if (eurAmount !== null) {
      // Check if the digits appear anywhere in rezumat (normalise punctuation)
      const normaliseAmount = (s: string) => s.replace(/[.,\s]/g, '')
      const normAmount = normaliseAmount(eurAmount)
      const normRezumat = normaliseAmount(rezumatSection.content)
      budgetConsistent = normRezumat.includes(normAmount)
    } else {
      // No EUR amount found in buget — can't determine consistency
      budgetConsistent = null
    }
  }

  const warnings: string[] = []

  if (failedSections.length > 0) {
    warnings.push(`${failedSections.length} section(s) failed to generate: ${failedSections.join(', ')}`)
  }
  if (placeholderSections.length > 0) {
    warnings.push(`Placeholder content detected in: ${placeholderSections.join(', ')}`)
  }
  if (truncatedSections.length > 0) {
    warnings.push(`Sections with insufficient content (< ${MIN_CONTENT_LENGTH} chars): ${truncatedSections.join(', ')}`)
  }
  if (budgetConsistent === false) {
    warnings.push('Budget amount in buget section not found in rezumat')
  }

  const passed =
    missingSections.length === 0 && duplicateSections.length === 0

  return {
    passed,
    missingSections,
    failedSections,
    placeholderSections,
    truncatedSections,
    duplicateSections,
    budgetConsistent,
    warnings,
  }
}
