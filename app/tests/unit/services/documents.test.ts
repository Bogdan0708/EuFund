import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import { getDocumentContent } from '@/lib/ai/agent/services/documents'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn() },
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-04-17T12:00:00Z')
const baseCtx = { userId: USER_ID, requestId: 'req-1', now: NOW }

function mockRow(ocrText: string | null) {
  return {
    fileId: FILE_ID,
    filename: 'bilant.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    uploadedAt: NOW,
    ocrText,
  }
}

function setupSelect(rows: ReturnType<typeof mockRow>[]) {
  vi.mocked(db.select).mockImplementation(
    () =>
      ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        }),
      }) as unknown as ReturnType<typeof db.select>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getDocumentContent', () => {
  it('returns extracted text up to maxChars', async () => {
    setupSelect([mockRow('Hello world. '.repeat(100))])

    const result = await getDocumentContent(baseCtx, FILE_ID, { maxChars: 20 })

    expect(result.extractedText.length).toBe(20)
    expect(result.truncated).toBe(true)
    expect(result.totalChars).toBeGreaterThan(20)
  })

  it('uses default 8000-char cap when maxChars omitted', async () => {
    setupSelect([mockRow('a'.repeat(20_000))])

    const result = await getDocumentContent(baseCtx, FILE_ID)

    expect(result.extractedText.length).toBe(8000)
    expect(result.truncated).toBe(true)
  })

  it('clamps maxChars to [500, 50000]', async () => {
    setupSelect([mockRow('a'.repeat(60_000))])

    const low = await getDocumentContent(baseCtx, FILE_ID, { maxChars: 100 })
    expect(low.extractedText.length).toBe(500)

    const high = await getDocumentContent(baseCtx, FILE_ID, { maxChars: 99_999 })
    expect(high.extractedText.length).toBe(50_000)
  })

  it('returns empty text and hasText=false when ocrText is null', async () => {
    setupSelect([mockRow(null)])

    const result = await getDocumentContent(baseCtx, FILE_ID)

    expect(result.extractedText).toBe('')
    expect(result.hasText).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('throws NotFoundError when no owned row matches', async () => {
    setupSelect([])

    await expect(getDocumentContent(baseCtx, FILE_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})
