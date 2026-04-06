import type { MatchedCall, FreshnessResult, GatewayClient } from './types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'freshness' })

const MAX_CALLS_TO_CHECK = 3

interface FreshnessApiResult {
  status: 'open' | 'closed' | 'unknown'
  deadline: string
  amendments: string[]
  evidence: string
}

function buildPrompt(calls: MatchedCall[]): string {
  const callList = calls
    .map((c, i) => `${i + 1}. "${c.title}" — URL: ${c.sourceUrl} — deadline we have: ${c.deadline}`)
    .join('\n')

  return `For each of these Romanian EU funding calls, verify if they are still open. Check the source URL and official Romanian funding platforms (mysmis2021.gov.ro, mfe.gov.ro).

${callList}

Return a JSON array with exactly ${calls.length} objects, one per call IN THE SAME ORDER:
{ "status": "open"|"closed"|"unknown", "deadline": string, "amendments": string[], "evidence": string }

If you cannot verify a call, set status to "unknown".`
}

function mapToFreshness(
  call: MatchedCall,
  apiResult: FreshnessApiResult | undefined,
  provider: string,
  model: string,
): FreshnessResult {
  if (!apiResult) {
    return {
      status: 'unknown',
      checkedAt: new Date().toISOString(),
      warnings: ['Call not included in freshness check'],
      provenance: { provider: 'skipped', model: '', sourceUrl: call.sourceUrl, evidence: '' },
    }
  }

  const warnings = [...apiResult.amendments]
  let status: FreshnessResult['status'] = 'verified'

  if (apiResult.status === 'closed') {
    status = 'stale'
  } else if (apiResult.status === 'unknown') {
    status = 'unknown'
  } else if (apiResult.deadline !== call.deadline && apiResult.deadline) {
    status = 'stale'
    warnings.push(`Deadline changed: ${call.deadline} → ${apiResult.deadline}`)
  }

  return {
    status,
    checkedAt: new Date().toISOString(),
    currentDeadline: apiResult.deadline || undefined,
    warnings,
    provenance: {
      provider,
      model,
      sourceUrl: call.sourceUrl,
      evidence: apiResult.evidence,
    },
  }
}

export async function checkCallFreshness(
  calls: MatchedCall[],
  gateway: GatewayClient,
): Promise<MatchedCall[]> {
  const toCheck = calls.slice(0, MAX_CALLS_TO_CHECK).filter(c => c.sourceUrl)

  if (toCheck.length === 0) return calls

  const prompt = buildPrompt(toCheck)
  let apiResults: FreshnessApiResult[] = []
  let provider = 'perplexity'
  let model = 'sonar'

  // Try Perplexity first, fallback to Gemini
  try {
    const result = await gateway.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'You verify Romanian EU funding call statuses. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 2000,
    })
    apiResults = JSON.parse(result.content)
  } catch (perplexityErr) {
    log.warn({ error: perplexityErr instanceof Error ? perplexityErr.message : String(perplexityErr) }, 'Perplexity freshness check failed, trying Gemini')
    provider = 'gemini'
    model = 'gemini-2.5-flash'

    try {
      const result = await gateway.generate({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        system: 'You verify Romanian EU funding call statuses. Return only valid JSON.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 2000,
      })
      apiResults = JSON.parse(result.content)
    } catch (geminiErr) {
      log.error({ error: geminiErr instanceof Error ? geminiErr.message : String(geminiErr) }, 'Both freshness providers failed')

      return calls.map(call => ({
        ...call,
        freshness: toCheck.some(c => c.callId === call.callId)
          ? {
              status: 'unknown' as const,
              checkedAt: new Date().toISOString(),
              warnings: ['Freshness check failed'],
              provenance: { provider: 'gemini', model: 'gemini-2.5-flash', sourceUrl: call.sourceUrl, evidence: '' },
            }
          : undefined,
      }))
    }
  }

  // Match by position — the prompt asks for results in the same order as the input
  let checkedIdx = 0
  return calls.map((call, i) => {
    if (i >= MAX_CALLS_TO_CHECK || !call.sourceUrl) return call
    const apiResult = apiResults[checkedIdx++]
    return {
      ...call,
      freshness: mapToFreshness(call, apiResult, provider, model),
    }
  })
}
