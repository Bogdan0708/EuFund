import { describe, it, expect, vi } from 'vitest'

// Mock next-auth and all its providers before any imports
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/microsoft-entra-id', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/email', () => ({ default: vi.fn() }))

vi.mock('@/lib/db', () => ({
  db: { query: { users: { findFirst: vi.fn() } } },
  withUserRLS: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/validators', () => ({
  loginSchema: { safeParse: vi.fn(() => ({ success: false })) },
}))
vi.mock('bcryptjs', () => ({ compare: vi.fn() }))
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, eq: vi.fn() }
})

describe('Auth config', () => {
  it('exports auth handlers', async () => {
    const { GET, POST, auth, signIn, signOut } = await import('@/lib/auth/index')
    expect(GET).toBeDefined()
    expect(POST).toBeDefined()
    expect(auth).toBeDefined()
    expect(signIn).toBeDefined()
    expect(signOut).toBeDefined()
  })
})
