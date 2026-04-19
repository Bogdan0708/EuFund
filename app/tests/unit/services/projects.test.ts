// app/tests/unit/services/projects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  projects: {
    id: 'id',
    createdBy: 'created_by',
    deletedAt: 'deleted_at',
  },
  documents: {
    id: 'doc_id',
    projectId: 'project_id',
    filename: 'filename',
    mimeType: 'mime_type',
    fileSize: 'file_size',
    createdAt: 'created_at',
    deletedAt: 'deleted_at',
    docType: 'doc_type',
    ocrText: 'ocr_text',
  },
  docTypeEnum: {
    enumValues: [
      'ghid_solicitant', 'bilant', 'certificat', 'aviz', 'studiu_fezabilitate',
      'plan_afaceri', 'deviz', 'acord_parteneriat', 'declaratie', 'altul',
    ],
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
  isNull: vi.fn(col => ({ isNull: col })),
  desc: vi.fn(col => ({ desc: col })),
  sql: vi.fn(() => ({ sql: 'mocked-sql' })),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { getProjectSummary, listUploadedDocuments, assertProjectOwnership } from '@/lib/ai/agent/services/projects'
import { NotFoundError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Helpers ────────────────────────────────────────────────────────────────

function setupDbSelectLimit(rows: unknown[]) {
  vi.mocked(db.select).mockImplementation(() => {
    const mockLimit = vi.fn().mockResolvedValue(rows)
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    return { from: mockFrom } as any
  })
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '55555555-5555-4555-8555-555555555555'

const baseCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'req-projects-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    orgId: ORG_ID,
    createdBy: USER_ID,
    title: 'Test Project',
    sectionSummary: 'A project about green energy',
    status: 'in_lucru',
    deletedAt: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-04-09T09:00:00Z'),
    ...overrides,
  }
}

// ── getProjectSummary tests ────────────────────────────────────────────────

describe('getProjectSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when project does not exist', async () => {
    setupDbSelectLimit([])

    await expect(getProjectSummary(baseCtx, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('NotFoundError has correct resourceType and resourceId', async () => {
    setupDbSelectLimit([])

    const err = await getProjectSummary(baseCtx, PROJECT_ID).catch(e => e)

    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.resourceType).toBe('project')
    expect(err.resourceId).toBe(PROJECT_ID)
  })

  it('throws NotFoundError when project belongs to a different user (simulated via empty rows)', async () => {
    // The WHERE clause filters by createdBy === ctx.userId, so a mismatch
    // returns no rows from the DB.
    setupDbSelectLimit([])

    const ctxOther: ServiceContext = { ...baseCtx, userId: OTHER_USER_ID }

    await expect(getProjectSummary(ctxOther, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns correct ProjectSummary for an owned project', async () => {
    const project = makeProject()
    setupDbSelectLimit([project])

    const summary = await getProjectSummary(baseCtx, PROJECT_ID)

    expect(summary.projectId).toBe(PROJECT_ID)
    expect(summary.title).toBe('Test Project')
    expect(summary.description).toBe('A project about green energy')
    expect(summary.organizationId).toBe(ORG_ID)
    expect(summary.status).toBe('in_lucru')
    expect(summary.createdAt).toEqual(project.createdAt)
    expect(summary.updatedAt).toEqual(project.updatedAt)
  })

  it('maps null sectionSummary to null description', async () => {
    const project = makeProject({ sectionSummary: null })
    setupDbSelectLimit([project])

    const summary = await getProjectSummary(baseCtx, PROJECT_ID)

    expect(summary.description).toBeNull()
  })

  it('falls back to ctx.now when createdAt is null', async () => {
    const project = makeProject({ createdAt: null, updatedAt: null })
    setupDbSelectLimit([project])

    const summary = await getProjectSummary(baseCtx, PROJECT_ID)

    expect(summary.createdAt).toEqual(baseCtx.now)
    expect(summary.updatedAt).toEqual(baseCtx.now)
  })

  it('falls back to ciorna status when status is null', async () => {
    const project = makeProject({ status: null })
    setupDbSelectLimit([project])

    const summary = await getProjectSummary(baseCtx, PROJECT_ID)

    expect(summary.status).toBe('ciorna')
  })
})

// ── assertProjectOwnership tests ───────────────────────────────────────────

describe('assertProjectOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when the user owns the project', async () => {
    setupDbSelectLimit([{ id: PROJECT_ID }])

    await expect(assertProjectOwnership(baseCtx, PROJECT_ID)).resolves.toBeUndefined()
  })

  it('throws NotFoundError when no row is returned', async () => {
    setupDbSelectLimit([])

    await expect(assertProjectOwnership(baseCtx, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ── listUploadedDocuments tests ────────────────────────────────────────────

describe('listUploadedDocuments', () => {
  const DOC_ID = '22222222-2222-4222-8222-222222222222'
  const UPLOADED_AT = new Date('2026-04-17T10:00:00Z')

  function makeRawRow(overrides: Partial<{
    fileId: string; filename: string; mimeType: string;
    sizeBytes: number; uploadedAt: Date; docType: string; hasText: boolean
  }> = {}) {
    return {
      fileId: DOC_ID,
      filename: 'bilant.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedAt: UPLOADED_AT,
      docType: 'bilant' as const,
      hasText: true,
      ...overrides,
    }
  }

  function mockSelectChain(rows: ReturnType<typeof makeRawRow>[]) {
    // db.select().from().innerJoin().where().orderBy().limit() → Promise<rows>
    const limit = vi.fn(() => Promise.resolve(rows))
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const innerJoin = vi.fn(() => ({ where }))
    const from = vi.fn(() => ({ innerJoin }))
    vi.mocked(db.select).mockReturnValueOnce({ from } as unknown as ReturnType<typeof db.select>)
    return { from, innerJoin, where, orderBy, limit }
  }

  it('maps rows into UploadedDocument shape', async () => {
    mockSelectChain([makeRawRow()])

    const docs = await listUploadedDocuments(baseCtx, PROJECT_ID)

    expect(docs).toEqual([
      {
        fileId: DOC_ID,
        filename: 'bilant.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        uploadedAt: UPLOADED_AT,
        docType: 'bilant',
        hasText: true,
      },
    ])
  })

  it('returns hasText=false for rows the mock reports as non-indexed', async () => {
    mockSelectChain([makeRawRow({ hasText: false })])

    const [doc] = await listUploadedDocuments(baseCtx, PROJECT_ID)
    expect(doc.hasText).toBe(false)
  })

  it('returns empty array when the query returns nothing', async () => {
    mockSelectChain([])

    const docs = await listUploadedDocuments(baseCtx, PROJECT_ID)

    expect(docs).toEqual([])
  })

  it('coerces null filename / mimeType / size / uploadedAt / docType to safe defaults', async () => {
    mockSelectChain([
      makeRawRow({
        filename: null as unknown as string,
        mimeType: null as unknown as string,
        sizeBytes: null as unknown as number,
        uploadedAt: null as unknown as Date,
        docType: null as unknown as 'bilant',
      }),
    ])

    const [doc] = await listUploadedDocuments(baseCtx, PROJECT_ID)

    expect(doc.filename).toBe('')
    expect(doc.mimeType).toBe('application/octet-stream')
    expect(doc.sizeBytes).toBe(0)
    expect(doc.uploadedAt).toBeInstanceOf(Date)
    expect(doc.docType).toBe('altul')
  })
})
