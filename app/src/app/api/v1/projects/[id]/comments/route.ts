// ─── Project Comments API ────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projectComments, projects, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { withAuthScope, requireOrgRole } from '@/lib/auth/helpers';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';

type Params = { params: { id: string } };

const commentSchema = z.object({
  section: z.string().max(100).optional(),
  content: z.string().min(1).max(5000),
});

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    return await withAuthScope(async (user) => {
      const project = await db.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
      if (!project) throw Errors.notFound('project', id);

      await requireOrgRole(user.id, project.orgId, 'viewer');

      const comments = await db
        .select({
          id: projectComments.id,
          section: projectComments.section,
          content: projectComments.content,
          resolved: projectComments.resolved,
          createdAt: projectComments.createdAt,
          userId: projectComments.userId,
          userName: users.fullName,
        })
        .from(projectComments)
        .innerJoin(users, eq(projectComments.userId, users.id))
        .where(eq(projectComments.projectId, id))
        .orderBy(desc(projectComments.createdAt));

      return NextResponse.json({ success: true, data: comments });
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    const body = await req.json();
    const parsed = commentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        Errors.validation('body', 'Date invalide', 'Invalid input').toResponse('ro'),
        { status: 400 },
      );
    }

    return await withAuthScope(async (user) => {
      const project = await db.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
      if (!project) throw Errors.notFound('project', id);

      await requireOrgRole(user.id, project.orgId, 'viewer');

      const [comment] = await db.insert(projectComments).values({
        projectId: id,
        userId: user.id,
        section: parsed.data.section,
        content: parsed.data.content,
      }).returning();

      return NextResponse.json({ success: true, data: comment }, { status: 201 });
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
