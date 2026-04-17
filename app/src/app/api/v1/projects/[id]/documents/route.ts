// ─── Project Documents List API ──────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { Errors, FondEUError } from '@/lib/errors'
import { requireAuth } from '@/lib/auth/helpers'
import {
  assertProjectOwnership,
  listUploadedDocuments,
} from '@/lib/ai/agent/services/projects'
import { NotFoundError } from '@/lib/ai/agent/services/errors'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'projects-documents-api' })

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { id: projectId } = params
    const ctx = {
      userId: user.id,
      requestId: crypto.randomUUID(),
      now: new Date(),
    }

    await assertProjectOwnership(ctx, projectId)

    const docs = await listUploadedDocuments(ctx, projectId)

    return NextResponse.json({
      success: true,
      data: docs.map((d) => ({
        fileId: d.fileId,
        filename: d.filename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt,
        docType: d.docType,
        hasText: d.hasText,
        downloadUrl: `/api/documents/${d.fileId}?download=true`,
      })),
    })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        Errors.notFound('project', params.id).toResponse('ro'),
        { status: 404 },
      )
    }
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), {
        status: error.statusCode,
      })
    }
    log.error({ error }, '[projects:documents]')
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 })
  }
}
