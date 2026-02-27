import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('DELETE /api/auth/account', () => {
  it('requires password confirmation and anonymizes account data', async () => {
    vi.resetModules();
    const tx = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    };
    const dbMock = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue({
            id: '123e4567-e89b-42d3-a456-426614174000',
            email: 'user@test.com',
            passwordHash: '$2a$10$kX5z4Q7By9A8rQUNV8GfUOq7lFQY4TO7q8PEfQgn2ulQn2xXhGQJ.', // "password123"
            fullName: 'User Test',
          }),
        },
      },
      transaction: vi.fn(async (fn: Function) => fn(tx)),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'user@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('bcryptjs', () => ({
      compare: vi.fn().mockResolvedValue(true),
    }));

    const { DELETE } = await import('@/app/api/auth/account/route');
    const req = new NextRequest('http://localhost:3000/api/auth/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(dbMock.transaction).toHaveBeenCalled();
  });
});

