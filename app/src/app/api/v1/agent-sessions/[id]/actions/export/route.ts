import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { enforceRateLimit } from '@/lib/middleware/rate-limit'
import { exportBody } from '@/lib/validation/agent-actions'
import { createExportSnapshot } from '@/lib/ai/agent/services/application'
import { errorToResponse } from '@/lib/api/agent-action-envelope'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await requireAuth()
  const rl = await enforceRateLimit(req, {
    keyPrefix: 'action-export',
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
    // Empty body OK for export — fall through to schema validation
    body = {}
  }
  const parsed = exportBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', messageRo: 'Cerere invalidă.', messageEn: 'Bad request.', details: parsed.error.flatten() } },
      { status: 400 },
    )
  }

  let snapshot
  try {
    snapshot = await createExportSnapshot(
      { userId: user.id, sessionId, requestId: randomUUID(), now: new Date() },
      sessionId,
    )
  } catch (err) {
    return errorToResponse(err)
  }

  return NextResponse.json(snapshot)
}
