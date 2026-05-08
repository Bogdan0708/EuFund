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

  let newFindings: Finding[]
  try {
    newFindings = await perplexitySweep()
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }

  for (const finding of newFindings) {
    const contentHash = computeContentHash(
      finding.title,
      finding.sourceDomain,
      finding.program || '',
    )

    const existing = await db
      .select({ id: discoveredCalls.id })
      .from(discoveredCalls)
      .where(eq(discoveredCalls.contentHash, contentHash))
      .limit(1)

    if (existing.length > 0) {
      result.duplicates++
      continue
    }

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
  const { createGatewayClient } = await import('@/lib/ai/gateway')
  const { captureException } = await import('@/lib/monitoring/sentry')
  const gateway = createGatewayClient('fondeu-discovery')

  let result
  try {
    result = await gateway.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'You search for newly published EU funding calls relevant to Romania. Return ONLY a JSON array of objects with: sourceUrl, sourceDomain, title, program, summary.',
      messages: [{ role: 'user', content: 'Find any new EU funding calls opened in the last 7 days relevant to Romanian organizations. Include PNRR, PEO, POTJ, POCIDIF, and Horizon Europe calls.' }],
      temperature: 0.1,
    })
  } catch (err) {
    await captureException(err, { source: 'perplexitySweep', phase: 'fetch' })
    throw err instanceof Error
      ? err
      : new Error(`perplexity sweep failed: ${String(err)}`)
  }

  try {
    return JSON.parse(result.content)
  } catch (err) {
    await captureException(err, {
      source: 'perplexitySweep',
      phase: 'parse',
      contentPreview: typeof result.content === 'string' ? result.content.slice(0, 500) : '',
    })
    throw new Error('perplexity sweep returned non-JSON content')
  }
}
