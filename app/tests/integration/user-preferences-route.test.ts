import { describe, expect, it, vi } from 'vitest';

// Migrated from e2e/api-health.spec.ts + e2e/settings.spec.ts.
// The existing app/tests/integration/user-preferences.test.ts only asserts the schema
// is exported; this file tests the route handler contract end-to-end through mocks.

describe('GET /api/v1/user/preferences', () => {
  it('returns defaults for a user with no stored preferences', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@test.com',
      }),
    }));

    const limitMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn().mockReturnValue({ from: fromMock }) },
    }));

    const { GET } = await import('@/app/api/v1/user/preferences/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      defaultModel: 'auto',
      responseStyle: 'detailed',
      autoApprove: false,
    });
  });

  it('returns the stored preferences when a row exists', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@test.com',
      }),
    }));

    const stored = {
      defaultModel: 'claude-sonnet',
      responseStyle: 'concise',
      autoApprove: true,
    };
    const limitMock = vi.fn().mockResolvedValue([stored]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn().mockReturnValue({ from: fromMock }) },
    }));

    const { GET } = await import('@/app/api/v1/user/preferences/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(stored);
  });
});

describe('PUT /api/v1/user/preferences', () => {
  it('rejects invalid JSON with 400', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: {} }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { PUT } = await import('@/app/api/v1/user/preferences/route');
    const request = new Request('http://localhost:3000/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it('rejects an out-of-range model with 400', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: {} }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { PUT } = await import('@/app/api/v1/user/preferences/route');
    const request = new Request('http://localhost:3000/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'not-a-model' }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it('persists a valid update, audits the change, and returns success', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
    }));

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    vi.doMock('@/lib/db', () => ({ db: { insert: insertMock } }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PUT } = await import('@/app/api/v1/user/preferences/route');
    const request = new Request('http://localhost:3000/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'auto', responseStyle: 'concise' }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.update',
      resourceType: 'user_preferences',
    }));
  });
});
