import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICES_ROOT = join(__dirname, '../../../src/lib/ai/agent/services')

const PHASE_3_WRITE_FUNCTIONS = [
  { file: 'sections.ts', fn: 'saveSectionDraft' },
  { file: 'sections.ts', fn: 'approveSection' },
  { file: 'sections.ts', fn: 'rollbackSection' },
  { file: 'sections.ts', fn: 'markSectionStale' },
  { file: 'sections.ts', fn: 'rejectSection' },
  { file: 'application.ts', fn: 'setSelectedCall' },
  { file: 'application.ts', fn: 'freezeOutline' },
  { file: 'application.ts', fn: 'setApplicationStatus' },
] as const

describe('policy matrix coverage', () => {
  for (const { file, fn } of PHASE_3_WRITE_FUNCTIONS) {
    it(`${file}:${fn} references POLICY_MATRIX`, () => {
      const src = readFileSync(join(SERVICES_ROOT, file), 'utf8')
      const fnStart = src.indexOf(`export async function ${fn}`)
      expect(fnStart, `${fn} not found in ${file}`).toBeGreaterThan(-1)

      // Find the closing paren of the function signature, tracking parens and angle brackets
      let parenDepth = 0
      let angleDepth = 0
      let closingParenIndex = -1
      for (let i = fnStart; i < src.length; i++) {
        if (src[i] === '<') angleDepth += 1
        if (src[i] === '>') angleDepth -= 1
        if (src[i] === '(' && angleDepth === 0) parenDepth += 1
        if (src[i] === ')' && angleDepth === 0) {
          parenDepth -= 1
          if (parenDepth === 0) { closingParenIndex = i; break }
        }
      }
      expect(closingParenIndex).toBeGreaterThan(-1)

      // Find the opening brace of the function body.
      // Strategy: scan from closing paren, tracking angle brackets and braces,
      // until we see a `{` that is NOT inside angle brackets (which would be a generic type).
      let bodyStart = -1
      let braceDepth = 0
      angleDepth = 0  // Reuse angleDepth from above
      for (let i = closingParenIndex; i < src.length; i++) {
        if (src[i] === '<') angleDepth += 1
        if (src[i] === '>') angleDepth -= 1
        if (src[i] === '{' && angleDepth === 0) {
          bodyStart = i
          braceDepth = 1
          break
        }
      }
      expect(bodyStart).toBeGreaterThan(-1)

      // Walk braces to find the matching closing brace for the function body
      let bodyEnd = bodyStart
      for (let i = bodyStart + 1; i < src.length; i++) {
        if (src[i] === '{') braceDepth += 1
        if (src[i] === '}') {
          braceDepth -= 1
          if (braceDepth === 0) { bodyEnd = i; break }
        }
      }
      const body = src.slice(bodyStart, bodyEnd)

      // Every Phase 3 write function must reference POLICY_MATRIX in its body.
      expect(body).toContain('POLICY_MATRIX')
    })
  }
})
