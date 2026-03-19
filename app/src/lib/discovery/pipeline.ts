import { db } from '@/lib/db'
import { discoveredCalls } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'

export interface DiscoveryResult {
  newCalls: number
  duplicates: number
  errors: string[]
}

function computeContentHash(title: string, domain: string, program: string): string {
  const normalized = `${title.toLowerCase().trim()}|${domain}|${program.toLowerCase().trim()}`
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { newCalls: 0, duplicates: 0, errors: [] }

  try {
    // Step 1: Run Perplexity sweep for new calls
    const newFindings = await perplexitySweep()

    for (const finding of newFindings) {
      const contentHash = computeContentHash(finding.title, finding.sourceDomain, finding.program || '')

      // Check for duplicates
      const existing = await db
        .select({ id: discoveredCalls.id })
        .from(discoveredCalls)
        .where(eq(discoveredCalls.contentHash, contentHash))
        .limit(1)

      if (existing.length > 0) {
        result.duplicates++
        continue
      }

      // Insert new discovery
      await db.insert(discoveredCalls).values({
        sourceUrl: finding.sourceUrl,
        sourceDomain: finding.sourceDomain,
        title: finding.title,
        program: finding.program,
        summary: finding.summary,
        contentHash,
        discoveryMethod: 'perplexity',
        status: 'pending_review',
      })
      result.newCalls++
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
  }

  return result
}

interface Finding {
  sourceUrl: string
  sourceDomain: string
  title: string
  program?: string
  summary?: string
}

async function perplexitySweep(): Promise<Finding[]> {
  try {
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const gateway = createGatewayClient('fondeu-discovery')

    const result = await gateway.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'You search for newly published EU funding calls relevant to Romania. Return ONLY a JSON array of objects with: sourceUrl, sourceDomain, title, program, summary.',
      messages: [{ role: 'user', content: 'Find any new EU funding calls opened in the last 7 days relevant to Romanian organizations. Include PNRR, PEO, POTJ, POCIDIF, and Horizon Europe calls.' }],
      temperature: 0.1,
    })

    try {
      return JSON.parse(result.content)
    } catch {
      return []
    }
  } catch {
    return []
  }
}
