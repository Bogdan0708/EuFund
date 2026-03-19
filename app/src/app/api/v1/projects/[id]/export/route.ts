import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { projects, projectDocuments } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { generateDocx } from '@/lib/export/docx'
import { Errors, FondEUError } from '@/lib/errors'
import type { ProjectSection } from '@/lib/ai/orchestrator/types'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const projectId = params.id
    const format = req.nextUrl.searchParams.get('format') || 'docx'

    if (format !== 'docx') {
      return NextResponse.json(
        Errors.validation('format', 'Only DOCX export is currently supported', 'Doar export DOCX este disponibil momentan').toResponse('ro'),
        { status: 400 }
      )
    }

    // Load project
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1)

    if (!project) {
      return NextResponse.json(Errors.notFound('project', projectId).toResponse('ro'), { status: 404 })
    }

    // Load latest project document
    const [doc] = await db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.version))
      .limit(1)

    if (!doc || !doc.sections) {
      return NextResponse.json(
        Errors.validation('sections', 'No project sections found for export', 'Nu există secțiuni de proiect pentru export').toResponse('ro'),
        { status: 400 }
      )
    }

    const sections = doc.sections as ProjectSection[]
    const buffer = await generateDocx(sections, {
      projectTitle: project.title,
      program: undefined, // Could load from call
    })

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${project.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.docx"`,
      },
    })
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode })
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 })
  }
}
