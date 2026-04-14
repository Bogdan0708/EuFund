import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'

const DOC_PATH = join(__dirname, '../../../../docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md')

describe('policy matrix docs sync', () => {
  it('every POLICY_MATRIX key appears in the doc rules table', () => {
    const doc = readFileSync(DOC_PATH, 'utf8')
    for (const key of Object.keys(POLICY_MATRIX)) {
      expect(doc, `${key} not found in policy matrix doc`).toContain(`\`${key}\``)
    }
  })

  it('every POLICY_MATRIX audit action appears in the doc', () => {
    const doc = readFileSync(DOC_PATH, 'utf8')
    for (const key of Object.keys(POLICY_MATRIX)) {
      const rule = POLICY_MATRIX[key as keyof typeof POLICY_MATRIX]
      expect(doc, `${key} audit action "${rule.auditAction}" not found in doc`).toContain(`\`${rule.auditAction}\``)
    }
  })
})
