import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { projects, projectDocuments } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { Errors, FondEUError } from '@/lib/errors'
import type { SubmissionDocument } from '@/lib/ai/orchestrator/types'

type Params = { params: { id: string; docId: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { id: projectId, docId } = params

    // Verify project ownership
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1)

    if (!project) {
      return NextResponse.json(Errors.notFound('project', projectId).toResponse('ro'), { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || !['not_started', 'completed'].includes(body.userStatus)) {
      return NextResponse.json({ error: 'Invalid userStatus' }, { status: 400 })
    }

    // Load latest project_documents
    const [doc] = await db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.version))
      .limit(1)

    if (!doc) {
      return NextResponse.json({ error: 'No project documents' }, { status: 404 })
    }

    const metadata = (doc.metadata ?? {}) as Record<string, unknown>
    const submissionDocs = (metadata.submissionDocuments ?? []) as SubmissionDocument[]
    const idx = submissionDocs.findIndex(d => d.id === docId)

    if (idx < 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Update user status
    submissionDocs[idx] = {
      ...submissionDocs[idx],
      userStatus: body.userStatus,
      userStatusAt: new Date().toISOString(),
    }

    await db.update(projectDocuments)
      .set({
        metadata: { ...metadata, submissionDocuments: submissionDocs } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(projectDocuments.id, doc.id))

    return NextResponse.json({ document: submissionDocs[idx] })
  } catch (err) {
    if (err instanceof FondEUError) {
      return NextResponse.json(err.toResponse('ro'), { status: err.statusCode })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
