// Regression for the May 18 2026 prod log: /api/ready returned 429 right after
// cold-start because the lazy Redis client's first call raced the connect.
// Readiness MUST answer even if rate-limit infrastructure is down, otherwise
// the load balancer marks the instance unhealthy and we get false outages.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  on: vi.fn(),
}))

const redisConstructor = vi.hoisted(() =>
  vi.fn(function RedisMock() {
    return redisMock
  }),
)

vi.mock('ioredis', () => ({
  default: redisConstructor,
}))

describe('/api/ready behaviour under Redis failure', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.REDIS_URL
  })

  it('returns 200 ready when Redis rejects (fail-open guard)', async () => {
    process.env.REDIS_URL = 'redis://10.0.0.1:6379'
    redisMock.incr.mockRejectedValue(new Error('redis down'))
    redisMock.expire.mockResolvedValue(1)

    const { GET } = await import('@/app/api/ready/route')

    const req = new NextRequest('https://example.com/api/ready', {
      method: 'GET',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ready')
  })

  it('still honors the rate limit when Redis is healthy and the client exceeds it', async () => {
    process.env.REDIS_URL = 'redis://10.0.0.1:6379'
    // Simulate a caller hitting the probe 13 times: under maxRequests=12 the
    // first 12 succeed; the 13th tips the counter over and we expect 429.
    redisMock.incr.mockImplementation(async () => 13)
    redisMock.expire.mockResolvedValue(1)

    const { GET } = await import('@/app/api/ready/route')

    const req = new NextRequest('https://example.com/api/ready', {
      method: 'GET',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })

    const res = await GET(req)
    expect(res.status).toBe(429)
  })
})
