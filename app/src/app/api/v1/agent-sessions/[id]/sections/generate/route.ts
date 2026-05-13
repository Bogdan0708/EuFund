// POST /api/v1/agent-sessions/[id]/sections/generate
//
// Streaming endpoint that drafts one section. The route runs
// ensureDraftingReady() (eligibility → freeze → write) BEFORE opening the
// stream — every saga precondition that needs user input returns a JSON
// 409 envelope before any model call. On success, opens text/event-stream
// with `start`, then N `delta` events, persists via saveSectionDraft, and
// emits a terminal `done` carrying a fresh UIStateSnapshot. Generation
// errors mid-stream are emitted as a single SSE `error` event.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateSectionBody } from '@/lib/validation/generate-section'
import { ensureDraftingReady } from '@/lib/ai/agent/services/ensure-drafting-ready'
import { streamSectionGeneration } from '@/lib/ai/agent/services/section-generation'
import { saveSectionDraft } from '@/lib/ai/agent/services/sections'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { GenerationInvalidError, ConcurrencyError } from '@/lib/ai/agent/services/errors'
import { trackGenerateSectionTotal, trackGenerateSectionLatency } from '@/lib/monitoring/metrics'
import { logger } from '@/lib/logger'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { enforceRateLimit } from '@/lib/middleware/rate-limit'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

export const dynamic = 'force-dynamic'

const log = logger.child({ component: 'api-sections-generate' })

type RouteParams = { params: Promise<{ id: string }> }

async function loadSessionAndRows(
  sessionId: string,
  userId: string,
): Promise<{ session: AgentSession | null; rows: AgentSection[] }> {
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
    .limit(1)
  const rows = session
    ? await db.select().from(agentSections).where(eq(agentSections.sessionId, sessionId))
    : []
  return {
    session: (session ?? null) as AgentSession | null,
    rows: rows as AgentSection[],
  }
}

function sseLine(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

interface SagaErrorEnvelope {
  code: string
  messageRo: string
  messageEn: string
  missing?: string[]
  details?: unknown
}

// Bilingual envelope for saga precondition errors. Hardcoded here so the
// route works end-to-end before Task 8 migrates to next-intl. Task 8 will
// refactor to read from agent.errors namespace.
function sagaErrorEnvelope(
  code: 'OUTLINE_NOT_READY' | 'NO_SECTION_TO_GENERATE' | 'ELIGIBILITY_INPUT_REQUIRED' | 'ELIGIBILITY_FAILED',
  extra: { missing?: string[]; details?: unknown } = {},
): SagaErrorEnvelope {
  switch (code) {
    case 'OUTLINE_NOT_READY':
      return {
        code,
        messageRo: 'Structura aplicației nu este pregătită. Continuă conversația cu asistentul.',
        messageEn: 'The application outline is not ready. Continue with the assistant.',
      }
    case 'NO_SECTION_TO_GENERATE':
      return {
        code,
        messageRo: 'Toate secțiunile sunt deja generate.',
        messageEn: 'All sections are already drafted.',
      }
    case 'ELIGIBILITY_INPUT_REQUIRED':
      return {
        code,
        messageRo: 'Mai avem nevoie de câteva informații despre proiect.',
        messageEn: 'We need a bit more information about the project.',
        missing: extra.missing,
      }
    case 'ELIGIBILITY_FAILED':
      return {
        code,
        messageRo: 'Cererea nu trece de verificarea de eligibilitate.',
        messageEn: 'The application does not pass eligibility.',
        details: extra.details,
      }
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const start = Date.now()
  const user = await requireAuth()

  // Kill-switch gate. `bypassCache: true` per CLAUDE.md — a 60s LRU cache
  // would otherwise delay an emergency disable during a flag flip.
  const flagOn = await isFeatureEnabled('generate_section_endpoint_enabled', {
    userId: user.id,
    bypassCache: true,
  })
  if (!flagOn) {
    return NextResponse.json(
      {
        error: {
          code: 'GENERATE_SECTION_DISABLED',
          messageRo: 'Generarea automată de secțiuni nu este activă.',
          messageEn: 'Section generation is not enabled.',
        },
      },
      { status: 404 },
    )
  }

  // Rate-limit per user. Generation is the most expensive call in the
  // product (Opus on heavy, ~4k output tokens + ~10k input). Cap by user
  // to prevent a single tab in a loop from draining the Anthropic budget.
  //
  // failOpenOnError: true — Redis disconnects on idle in dev and the
  // first request after reconnect-needed throws inside checkRateLimit,
  // which under `failOpenOnError: false` returns 429 to a legitimate
  // user. The actual cap (20/hour) is generous AND the user pays for
  // their own model usage, so falling open on Redis transient errors
  // is the right cost/UX trade-off.
  const rl = await enforceRateLimit(req, {
    keyPrefix: 'generate-section',
    keySuffix: user.id,
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
    failOpenOnError: true,
  })
  if (!rl.ok) return rl.response

  const { id: sessionId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_JSON',
          messageRo: 'Corpul cererii nu este JSON valid.',
          messageEn: 'Request body is not valid JSON.',
        },
      },
      { status: 400 },
    )
  }

  const parsed = generateSectionBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          messageRo: 'Cerere invalidă.',
          messageEn: 'Bad request.',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    )
  }

  const requestId = randomUUID()
  const svcCtx: ServiceContext = {
    userId: user.id,
    sessionId,
    requestId,
    now: new Date(),
  }

  const initial = await loadSessionAndRows(sessionId, user.id)
  if (!initial.session) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          messageRo: 'Sesiune inexistentă.',
          messageEn: 'Session not found.',
        },
      },
      { status: 404 },
    )
  }

  // Run preconditions — every failure path returns JSON 409 BEFORE any
  // stream is opened. Saga itself calls runEligibilityForSession and
  // freezeOutline as needed; service errors (ConcurrencyError, etc.) bubble
  // up and we map them here.
  let ready: Awaited<ReturnType<typeof ensureDraftingReady>>
  try {
    ready = await ensureDraftingReady(
      initial.session,
      {
        expectedStateVersion: parsed.data.expectedStateVersion,
        sectionKey: parsed.data.sectionKey,
        projectSummary: parsed.data.projectSummary,
      },
      initial.rows,
      svcCtx,
    )
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      trackGenerateSectionTotal({ outcome: 'precondition', reason: 'CONCURRENCY_CONFLICT' })
      return NextResponse.json(
        {
          error: {
            code: 'CONCURRENCY_CONFLICT',
            messageRo: 'Starea a fost actualizată între timp. Reîncarcă și reîncearcă.',
            messageEn: 'State has changed since you started. Reload and retry.',
            expected: err.expected,
            actual: err.actual,
          },
        },
        { status: 409 },
      )
    }
    log.error(
      { sessionId, requestId, err: err instanceof Error ? err.message : String(err) },
      'ensureDraftingReady threw unexpected error',
    )
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL',
          messageRo: 'Eroare internă. Reîncearcă.',
          messageEn: 'Internal error. Try again.',
        },
      },
      { status: 500 },
    )
  }

  if (!ready.ok) {
    trackGenerateSectionTotal({ outcome: 'precondition', reason: ready.code })
    return NextResponse.json(
      {
        error: sagaErrorEnvelope(
          ready.code,
          'missing' in ready
            ? { missing: ready.missing }
            : 'details' in ready
              ? { details: ready.details }
              : {},
        ),
      },
      { status: 409 },
    )
  }

  // Reload to pick up writes the saga performed (eligibility, freeze).
  const post = await loadSessionAndRows(sessionId, user.id)
  if (!post.session) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          messageRo: 'Sesiune inexistentă.',
          messageEn: 'Session not found.',
        },
      },
      { status: 404 },
    )
  }

  // `ready` is narrowed to `{ ok: true; sectionSpec: SectionSpec; stateVersion: number }`
  // Capture in a const so closures see the narrowed type.
  const readyOk = ready
  // Destructure after null guard so the stream closure captures narrowed (non-null) types.
  const postSession = post.session
  const postRows = post.rows

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          sseLine('start', { sectionKey: readyOk.sectionSpec.id, title: readyOk.sectionSpec.title }),
        )

        let full = ''
        for await (const d of streamSectionGeneration(svcCtx, {
          session: postSession,
          spec: readyOk.sectionSpec,
          priorSections: postRows,
        })) {
          if (d.type === 'delta') {
            full += d.content
            controller.enqueue(sseLine('delta', { content: d.content }))
          } else if (d.type === 'final') {
            full = d.content
          }
        }

        // Persist
        await saveSectionDraft(svcCtx, {
          sessionId,
          sectionKey: readyOk.sectionSpec.id,
          content: full,
          expectedStateVersion: readyOk.stateVersion,
        })

        // Final snapshot
        const final = await loadSessionAndRows(sessionId, user.id)
        if (!final.session) {
          controller.enqueue(
            sseLine('error', {
              code: 'NOT_FOUND',
              messageRo: 'Sesiune inexistentă.',
              messageEn: 'Session not found.',
            }),
          )
          trackGenerateSectionTotal({ outcome: 'failure', reason: 'NOT_FOUND' })
          return
        }

        controller.enqueue(
          sseLine('done', projectSessionState(final.session, final.rows)),
        )
        trackGenerateSectionTotal({ outcome: 'success' })
      } catch (err) {
        let code = 'PROVIDER_ERROR'
        let messageRo = 'Eroare de furnizor AI. Reîncearcă.'
        let messageEn = 'AI provider error. Try again.'

        if (err instanceof GenerationInvalidError) {
          code = 'GENERATION_INVALID'
          messageRo = 'Conținutul generat nu este valid. Reîncearcă.'
          messageEn = 'Generated content was invalid. Try again.'
        } else if (err instanceof ConcurrencyError) {
          code = 'CONCURRENCY_CONFLICT'
          messageRo = 'Starea a fost actualizată între timp. Reîncarcă și reîncearcă.'
          messageEn = 'State has changed since you started. Reload and retry.'
        } else {
          log.error(
            { sessionId, requestId, err: err instanceof Error ? err.message : String(err) },
            'unexpected error in generate-section stream',
          )
        }

        controller.enqueue(sseLine('error', { code, messageRo, messageEn }))
        trackGenerateSectionTotal({ outcome: 'failure', reason: code })
      } finally {
        trackGenerateSectionLatency((Date.now() - start) / 1000)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
