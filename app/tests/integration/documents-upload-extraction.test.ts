// app/tests/integration/documents-upload-extraction.test.ts
// Prerequisites:
//   1. docker compose up -d postgres (port 5433) with migrations applied.
//   2. HAS_RLS_DATABASE=true in the env.
//   3. Fixture orgs + projects for USER_A and USER_B seeded by beforeAll.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { POST as uploadPost } from '@/app/api/documents/upload/route'
import { GET as listGet } from '@/app/api/v1/projects/[id]/documents/route'
import { getDocumentContent } from '@/lib/ai/agent/services/documents'
import { NotFoundError } from '@/lib/ai/agent/services/errors'
import { db } from '@/lib/db'
import { documents, projects, users, organizations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { deleteObject } from '@/lib/storage/gcs'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const PROJECT_A = '44444444-4444-4444-8444-444444444444'
const PROJECT_B = '55555555-5555-4555-8555-555555555555'

// Route-level tests authenticate as USER_A throughout. Cross-user behavior is
// verified by calling services directly with a different ctx.userId (see the
// getDocumentContent test at the end of the suite). Do NOT swap this mock
// between tests — mock state leaks across vitest cases and produces false positives.
vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(async () => ({ id: USER_A })),
}))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

// listUploadedDocuments + assertProjectOwnership also need direct-service import
// for the cross-user test below.
import {
  listUploadedDocuments,
  assertProjectOwnership,
} from '@/lib/ai/agent/services/projects'

async function makeUploadRequest(
  content: Uint8Array,
  filename: string,
  mime: string,
  projectId = PROJECT_A,
) {
  const form = new FormData()
  form.append('file', new Blob([content as unknown as ArrayBuffer], { type: mime }), filename)
  form.append('projectId', projectId)
  form.append('docType', 'altul')
  return new Request('http://localhost/api/documents/upload', {
    method: 'POST',
    body: form,
  })
}

// Minimal valid PDF (one-page, "Hello" text stream) — keeps the fixture self-contained.
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello integration) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000053 00000 n\n0000000099 00000 n\n0000000187 00000 n\n0000000277 00000 n\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n333\n%%EOF',
  'utf-8',
)

// Minimal `.doc` magic bytes — pdf-parse/mammoth will not handle it.
const DOC_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])

describe.skipIf(!process.env.HAS_RLS_DATABASE)('document upload + extraction', () => {
  const createdDocIds: string[] = []

  beforeAll(async () => {
    // Column names mirror schema.ts exactly:
    //   users.fullName (not "name"), organizations.orgType/orgSize (not "type"/"size").
    await db
      .insert(users)
      .values([
        { id: USER_A, email: 'test-uploads-a@test.local', fullName: 'Test User A', passwordHash: 'x', tier: 'free' },
        { id: USER_B, email: 'test-uploads-b@test.local', fullName: 'Test User B', passwordHash: 'x', tier: 'free' },
      ])
      .onConflictDoNothing()

    await db
      .insert(organizations)
      .values({
        id: ORG_A,
        name: 'Test Uploads Org',
        cui: 'RO-TST-UPLADR',
        orgType: 'srl',
        orgSize: 'micro',
      })
      .onConflictDoNothing()

    // projects has BOTH userId and createdBy columns. The RLS policy in
    // app/src/lib/db/rls.sql gates SELECT on `user_id`, so withUserRLS
    // in the upload route only sees rows where user_id matches. Our services'
    // ownership join uses created_by. Seed both to the same value so the
    // upload route's RLS-gated preload AND the service-layer join both work.
    await db
      .insert(projects)
      .values([
        { id: PROJECT_A, title: 'Test Upload Project A', userId: USER_A, createdBy: USER_A, orgId: ORG_A, status: 'ciorna' },
        { id: PROJECT_B, title: 'Test Upload Project B', userId: USER_B, createdBy: USER_B, orgId: ORG_A, status: 'ciorna' },
      ])
      .onConflictDoNothing()
  })

  afterAll(async () => {
    // Uploads go through the real storage layer (lib/storage/gcs.ts) which
    // writes to GCS when GCS_BUCKET is set, else local ./uploads/. Deleting
    // only the DB row leaves blobs behind and accumulates across runs, so
    // fetch storagePath first and explicitly remove the object, then hard-
    // delete the row. We do NOT call DELETE /api/documents/[id] here because
    // that is a soft-delete — the test DB wants the row gone entirely.
    for (const id of createdDocIds) {
      const rows = await db
        .select({ storagePath: documents.storagePath })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)
      const storagePath = rows[0]?.storagePath
      if (storagePath) {
        try {
          await deleteObject(storagePath)
        } catch {
          // Best effort — a missing blob (already cleaned) should not fail
          // the suite's teardown.
        }
      }
      await db.delete(documents).where(eq(documents.id, id))
    }
    createdDocIds.length = 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes ocr_text for a small TXT upload and surfaces hasText', async () => {
    const req = await makeUploadRequest(new TextEncoder().encode('hello world\nthis is a test'), 'hello.txt', 'text/plain')
    const res = await uploadPost(req as unknown as import('next/server').NextRequest)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.hasText).toBe(true)
    createdDocIds.push(body.data.id)

    const listRes = await listGet({} as unknown as import('next/server').NextRequest, { params: { id: PROJECT_A } })
    const listBody = await listRes.json()
    const found = listBody.data.find((d: { fileId: string }) => d.fileId === body.data.id)
    expect(found?.hasText).toBe(true)
    expect(found?.docType).toBe('altul')
  })

  it('extracts text from a minimal valid PDF', async () => {
    const req = await makeUploadRequest(MINIMAL_PDF, 'hello.pdf', 'application/pdf')
    const res = await uploadPost(req as unknown as import('next/server').NextRequest)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.hasText).toBe(true)
    createdDocIds.push(body.data.id)

    const content = await getDocumentContent(
      { userId: USER_A, requestId: 'test', now: new Date() },
      body.data.id,
    )
    expect(content.extractedText.toLowerCase()).toContain('hello')
    expect(content.truncated).toBe(false)
  })

  it('persists a corrupted PDF with hasText=false', async () => {
    const corrupted = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([0, 1, 2, 3, 4])])
    const req = await makeUploadRequest(corrupted, 'corrupt.pdf', 'application/pdf')
    const res = await uploadPost(req as unknown as import('next/server').NextRequest)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.hasText).toBe(false)
    createdDocIds.push(body.data.id)
  })

  it('accepts .doc upload with hasText=false (extraction unsupported)', async () => {
    const req = await makeUploadRequest(DOC_HEADER, 'legacy.doc', 'application/msword')
    const res = await uploadPost(req as unknown as import('next/server').NextRequest)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.hasText).toBe(false)
    createdDocIds.push(body.data.id)
  })

  it('getDocumentContent throws NotFoundError for a file the user does not own', async () => {
    // Upload as USER_A (via the real route), then query at the service layer as USER_B.
    const req = await makeUploadRequest(new TextEncoder().encode('owner-scoped'), 'owner.txt', 'text/plain')
    const res = await uploadPost(req as unknown as import('next/server').NextRequest)
    const { data } = await res.json()
    createdDocIds.push(data.id)

    await expect(
      getDocumentContent({ userId: USER_B, requestId: 'test', now: new Date() }, data.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('listUploadedDocuments returns empty array when called as a non-owner', async () => {
    // Service-level cross-user coverage. USER_A owns PROJECT_A; USER_B calling the
    // service for PROJECT_A must see an empty list (join filters it out).
    const docs = await listUploadedDocuments(
      { userId: USER_B, requestId: 'test', now: new Date() },
      PROJECT_A,
    )
    expect(docs).toEqual([])
  })

  it('assertProjectOwnership throws NotFoundError for a non-owner', async () => {
    await expect(
      assertProjectOwnership(
        { userId: USER_B, requestId: 'test', now: new Date() },
        PROJECT_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('GET /api/v1/projects/:id/documents returns 404 for a project the user does not own', async () => {
    // requireAuth is pinned to USER_A at the top of the file. Asking for PROJECT_B
    // (owned by USER_B) must get a 404.
    const listRes = await listGet(
      {} as unknown as import('next/server').NextRequest,
      { params: { id: PROJECT_B } },
    )
    expect(listRes.status).toBe(404)
  })
})
