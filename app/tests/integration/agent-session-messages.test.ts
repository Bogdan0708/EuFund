import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /api/ai/agent/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));
  });

  it('returns messages for session owner', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 'm1', role: 'user', content: 'Hello', toolName: null, toolCallId: null, createdAt: new Date() },
                { id: 'm2', role: 'assistant', content: 'Hi there', toolName: null, toolCallId: null, createdAt: new Date() },
                { id: 'm3', role: 'tool', content: '{"result": true}', toolName: 'search-calls', toolCallId: 'tc1', createdAt: new Date() },
              ]),
            }),
          }),
        }),
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
        },
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/messages/route');
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/messages`);
    const res = await GET(req, { params: { sessionId: SESSION_ID } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);
    expect(json.data[2].role).toBe('tool');
    expect(json.data[2].toolName).toBe('search-calls');
  });

  it('returns 404 for non-existent or other user session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/messages/route');
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/messages`);
    const res = await GET(req, { params: { sessionId: SESSION_ID } });

    expect(res.status).toBe(404);
  });
});
