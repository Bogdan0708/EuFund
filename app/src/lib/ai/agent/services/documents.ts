// ── Documents Service ─────────────────────────────────────────────────────
// Read-only operations on the documents table scoped by project ownership.
// Layer rule (mirrors projects.ts): import only from @/lib/db, @/lib/db/schema,
// drizzle-orm, ./errors, and ./types.

import { db } from '@/lib/db'
import { projects, documents } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type { ServiceContext } from './types'

const DEFAULT_MAX_CHARS = 8_000
const MIN_MAX_CHARS = 500
const MAX_MAX_CHARS = 50_000

export interface DocumentContent {
  fileId: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
  extractedText: string
  hasText: boolean
  truncated: boolean
  totalChars: number
}

function clampMaxChars(n: number | undefined): number {
  if (n === undefined) return DEFAULT_MAX_CHARS
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS
  return Math.min(Math.max(Math.trunc(n), MIN_MAX_CHARS), MAX_MAX_CHARS)
}

export async function getDocumentContent(
  ctx: ServiceContext,
  fileId: string,
  opts: { maxChars?: number } = {},
): Promise<DocumentContent> {
  const rows = await db
    .select({
      fileId: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      sizeBytes: documents.fileSize,
      uploadedAt: documents.createdAt,
      ocrText: documents.ocrText,
    })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(
      and(
        eq(documents.id, fileId),
        eq(projects.createdBy, ctx.userId),
        isNull(projects.deletedAt),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new NotFoundError('document', fileId)
  }

  const fullText = row.ocrText ?? ''
  const maxChars = clampMaxChars(opts.maxChars)
  const truncated = fullText.length > maxChars
  const extractedText = truncated ? fullText.slice(0, maxChars) : fullText

  return {
    fileId: row.fileId,
    filename: row.filename ?? '',
    mimeType: row.mimeType ?? 'application/octet-stream',
    sizeBytes: Number(row.sizeBytes ?? 0),
    uploadedAt: row.uploadedAt ?? ctx.now,
    extractedText,
    hasText: fullText.length > 0,
    truncated,
    totalChars: fullText.length,
  }
}
