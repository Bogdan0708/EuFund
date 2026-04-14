// app/src/lib/ai/agent/tools/validate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, SectionStatus } from '../types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-validate-section' })

const inputSchema = z.object({
  sectionKey: z.string().min(1),
})

type Input = z.infer<typeof inputSchema>

interface ValidationIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

interface ValidationResult {
  issues: ValidationIssue[]
  recommendedStatus: SectionStatus
  score: number // 0-100
}

// Placeholder patterns that indicate AI slop
const PLACEHOLDER_PATTERNS = [
  /\[insert\s/i,
  /\[add\s/i,
  /\[your\s/i,
  /\[company\s?name\]/i,
  /\[project\s?name\]/i,
  /\[TBD\]/i,
  /\[TODO\]/i,
  /\[placeholder\]/i,
  /\[fill\s?in\]/i,
  /XXX/,
  /___+/,
  /\.{4,}/, // Long ellipsis runs
]

const MIN_LENGTHS: Record<string, number> = {
  short: 300,
  medium: 700,
  long: 1500,
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<ValidationResult>> {
  const start = Date.now()

  const section = ctx.sections.find(s => s.sectionKey === input.sectionKey)
  if (!section) {
    return {
      success: false,
      error: `Section "${input.sectionKey}" not found`,
      retryable: false,
      telemetry: { latencyMs: Date.now() - start },
    }
  }

  const content = section.content || ''
  const issues: ValidationIssue[] = []

  // 1. Check for empty/very short content
  if (!content.trim()) {
    issues.push({ code: 'EMPTY', severity: 'error', message: 'Section has no content' })
  }

  // 2. Check minimum length based on spec
  const spec = (ctx.session.outline || []).find((s: any) => s.id === input.sectionKey)
  const expectedLength = (spec as any)?.expectedLength || 'medium'
  const minLen = MIN_LENGTHS[expectedLength] || 700
  if (content.length < minLen) {
    issues.push({
      code: 'TOO_SHORT',
      severity: 'warning',
      message: `Content is ${content.length} chars, expected at least ${minLen} for ${expectedLength} sections`,
    })
  }

  // 3. Check for placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = content.match(pattern)
    if (match) {
      issues.push({
        code: 'PLACEHOLDER',
        severity: 'error',
        message: `Found placeholder text: "${match[0]}"`,
      })
    }
  }

  // 4. Check for excessive repetition (same sentence repeated)
  const sentences = content.split(/[.!?]\s+/).filter(s => s.length > 20)
  const seen = new Set<string>()
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().trim()
    if (seen.has(normalized)) {
      issues.push({ code: 'REPETITION', severity: 'warning', message: 'Repeated sentence detected' })
      break
    }
    seen.add(normalized)
  }

  // 5. Calculate score
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - (errorCount * 30) - (warningCount * 10))

  // 6. Recommend status and emit transition
  let recommendedStatus: SectionStatus = 'draft'
  if (errorCount > 0) {
    recommendedStatus = 'failed'
  } else {
    recommendedStatus = 'needs_review' // Validated, ready for user acceptance
  }

  const result: ValidationResult = { issues, recommendedStatus, score }

  log.info({ sectionKey: input.sectionKey, issues: issues.length, score, status: recommendedStatus }, 'Section validated')

  return {
    success: true,
    data: result,
    warnings: issues.filter(i => i.severity !== 'info').map(i => `[${i.code}] ${i.message}`),
    // When validation passes, mark section as needs_review (ready for user acceptance)
    // When validation fails, no transition — section stays as draft
    stateTransitions: errorCount === 0
      ? [{ type: 'REJECT_SECTION' as const, sectionKey: input.sectionKey, reason: 'Validation passed — ready for review' }]
      : undefined,
    telemetry: { latencyMs: Date.now() - start },
  }
}

registerTool({
  name: 'validate_section',
  category: 'decision',
  description: 'Validate a generated section for quality issues — placeholders, length, repetition',
  inputSchema,
  execute: execute as any,
  timeout: 5_000,
})
