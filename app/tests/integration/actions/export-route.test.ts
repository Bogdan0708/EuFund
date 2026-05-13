import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isFeatureEnabledMock } = vi.hoisted(() => ({
  isFeatureEnabledMock: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}))

vi.mock('@/lib/auth/helpers', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }) }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const createExportSnapshotSpy = vi.fn().mockResolvedValue({
  snapshotId: 'snap-1',
  format: 'json',
  downloadUrl: 'https://x/snap-1',
  expiresAt: new Date('2026-12-31'),
})
vi.mock('@/lib/ai/agent/services/application', () => ({
  createExportSnapshot: createExportSnapshotSpy,
}))

describe('POST /actions/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isFeatureEnabledMock.mockResolvedValue(true)
    createExportSnapshotSpy.mockResolvedValue({
      snapshotId: 'snap-1',
      format: 'json',
      downloadUrl: 'https://x/snap-1',
      expiresAt: new Date('2026-12-31'),
    })
  })

  it('200 on empty body, returns snapshot', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/actions/export/route')
    const res = await POST(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({}) }) as never,
      { params: Promise.resolve({ id: 's1' }) },
    )
    expect(res.status).toBe(200)
    expect(createExportSnapshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      's1',
    )
    const body = await res.json()
    expect(body.snapshotId).toBe('snap-1')
  })

  it('400 on extraneous body fields (strict schema)', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/actions/export/route')
    const res = await POST(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ extra: 'foo' }) }) as never,
      { params: Promise.resolve({ id: 's1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('200 on absent body (handler defaults to {})', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/actions/export/route')
    const res = await POST(
      new Request('http://localhost/x', { method: 'POST' }) as never,
      { params: Promise.resolve({ id: 's1' }) },
    )
    expect(res.status).toBe(200)
  })
})
