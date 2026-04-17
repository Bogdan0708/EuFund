// ── Projects Service ───────────────────────────────────────────────────────
// Read-only operations on the projects table.
// Enforces ownership via userId match and org membership is not checked here
// (the project row carries userId from creator).
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, and ./types. No V3 or MCP imports.

import { db } from '@/lib/db'
import { projects, documents, docTypeEnum } from '@/lib/db/schema'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type {
  ServiceContext, ProjectSummary, UploadedDocument, DocumentType,
} from './types'

// Soft cap to keep tool responses bounded. If this ever changes, also update
// the tool description in mcp/read/list-uploaded-documents.ts.
const LIST_UPLOADED_DOCUMENTS_LIMIT = 100

// Compile-time guard: the schema enum is the source of truth. If it ever
// diverges from the DocumentType union in services/types.ts, this line
// fails to typecheck.
type _EnumCheck = (typeof docTypeEnum.enumValues)[number] extends DocumentType
  ? DocumentType extends (typeof docTypeEnum.enumValues)[number]
    ? true
    : false
  : false
const _enumCheck: _EnumCheck = true
void _enumCheck

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

// ── assertProjectOwnership ────────────────────────────────────────────────

/**
 * Verifies the caller owns the project (non-deleted, created_by = userId).
 * Throws NotFoundError otherwise. Use this to gate callers (REST routes,
 * MCP tools) that need to return 404 on unauthorized access.
 */
export async function assertProjectOwnership(
  ctx: ServiceContext,
  projectId: string,
): Promise<void> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.createdBy, ctx.userId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)

  if (rows.length === 0) {
    throw new NotFoundError('project', projectId)
  }
}

// ── listUploadedDocuments ──────────────────────────────────────────────────

export async function listUploadedDocuments(
  ctx: ServiceContext,
  projectId: string,
): Promise<UploadedDocument[]> {
  const rows = await db
    .select({
      fileId: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      sizeBytes: documents.fileSize,
      uploadedAt: documents.createdAt,
      docType: documents.docType,
      hasText: sql<boolean>`(${documents.ocrText} IS NOT NULL AND length(${documents.ocrText}) > 0)`,
    })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.createdBy, ctx.userId),
        isNull(projects.deletedAt),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(LIST_UPLOADED_DOCUMENTS_LIMIT)

  return rows.map((r) => ({
    fileId: r.fileId,
    filename: r.filename ?? '',
    mimeType: r.mimeType ?? 'application/octet-stream',
    sizeBytes: Number(r.sizeBytes ?? 0),
    uploadedAt: r.uploadedAt ?? ctx.now,
    docType: (r.docType ?? 'altul') as DocumentType,
    hasText: Boolean(r.hasText),
  }))
}
