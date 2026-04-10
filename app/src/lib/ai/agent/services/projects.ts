// ── Projects Service ───────────────────────────────────────────────────────
// Read-only operations on the projects table.
// Enforces ownership via userId match and org membership is not checked here
// (the project row carries userId from creator).
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, and ./types. No V3 or MCP imports.

import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type { ServiceContext, ProjectSummary, UploadedDocument } from './types'

// ── getProjectSummary ──────────────────────────────────────────────────────

/**
 * Loads a summary of the project, verifying the request comes from the
 * project's creator. Throws `NotFoundError` when the project doesn't exist
 * or belongs to a different user.
 */
export async function getProjectSummary(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectSummary> {
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.createdBy, ctx.userId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)

  const project = rows[0]
  if (!project) {
    throw new NotFoundError('project', projectId)
  }

  return {
    projectId: project.id,
    title: project.title,
    description: project.sectionSummary ?? null,
    organizationId: project.orgId,
    status: project.status ?? 'ciorna',
    createdAt: project.createdAt ?? ctx.now,
    updatedAt: project.updatedAt ?? ctx.now,
  }
}

// ── listUploadedDocuments ──────────────────────────────────────────────────

/**
 * Returns documents associated with the project.
 * The documents table is not fully wired yet — returns empty array for now.
 * This satisfies the service contract so callers can rely on the shape.
 */
export async function listUploadedDocuments(
  _ctx: ServiceContext,
  _projectId: string,
): Promise<UploadedDocument[]> {
  // Documents table integration is pending — return empty list.
  // When the table is ready, replace this with a DB query filtered by
  // projectId and the requesting userId.
  return []
}
