import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

describe('AI Wizard routes', () => {
  // ─── Streaming chat route tests ──────────────────────────────────

  it('wizard/chat rejects unauthenticated requests', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      authenticateAIUser: vi.fn().mockResolvedValue({
        errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      }),
    }));
    vi.doMock('@/lib/rag/pipeline', () => ({
      hybridSearch: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('ai', async (importOriginal) => {
      const orig = await importOriginal<typeof import('ai')>();
      return {
        ...orig,
        streamText: vi.fn(),
      };
    });
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      enhanceProjectIdea: vi.fn(),
      matchFundingCalls: vi.fn(),
      generateProjectProposal: vi.fn(),
      saveWizardProject: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/chat/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('wizard/chat returns streaming response for authenticated user', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      authenticateAIUser: vi.fn().mockResolvedValue({
        user: { id: 'user-1', tier: 'pro', email: 'u@test.com' },
      }),
    }));
    vi.doMock('@/lib/rag/pipeline', () => ({
      hybridSearch: vi.fn().mockResolvedValue([]),
    }));
    // Mock the AI SDK streamText to return a minimal streaming response
    vi.doMock('ai', async (importOriginal) => {
      const orig = await importOriginal<typeof import('ai')>();
      return {
        ...orig,
        streamText: vi.fn().mockReturnValue({
          toUIMessageStreamResponse: () => new Response('data: []\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        }),
      };
    });
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      enhanceProjectIdea: vi.fn(),
      matchFundingCalls: vi.fn(),
      generateProjectProposal: vi.fn(),
      saveWizardProject: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/chat/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Vreau să digitalizez primăria' }],
          },
        ],
        locale: 'ro',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });

  // ─── Step wizard route tests ─────────────────────────────────────

  it('enhance-idea returns enhanced payload', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      enhanceProjectIdea: vi.fn().mockResolvedValue({
        enhancedIdea: 'Enhanced idea\n- Suggestion 1\n- Suggestion 2',
        suggestions: ['- Suggestion 1', '- Suggestion 2'],
        structuredSummary: 'Enhanced idea',
        originalIdea: 'O idee de proiect suficient de lungă pentru validare minimă.',
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/enhance-idea/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/enhance-idea', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIdea: 'O idee de proiect suficient de lungă pentru validare minimă.', locale: 'ro' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.enhancedIdea).toContain('Enhanced idea');
    expect(payload.data.suggestions.length).toBeGreaterThan(0);
  });

  it('match-calls returns ranked matches from DB calls', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      matchFundingCalls: vi.fn().mockResolvedValue({
        matches: [{
          call: { id: 'call-1', callCode: 'PNRR-001', titleRo: 'Call title', programName: 'PNRR' },
          eligibilityScore: 80,
          relevanceScore: 77,
          overallScore: 79,
          recommendations: [],
        }],
        aiAct: null,
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/match-calls/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/match-calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectIdea: 'Idee de proiect pentru digitalizare în manufactură.',
        organization: { orgType: 'srl' },
        budget: 200000,
        locale: 'ro',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.matches.length).toBe(1);
  });

  it('generate-project returns proposal payload', async () => {
    vi.resetModules();

    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: vi.fn(async (_req: NextRequest, handler: (user: { id: string; tier: 'pro'; email: string }) => Promise<Response>) => {
        return handler({ id: 'user-1', tier: 'pro', email: 'u@test.com' });
      }),
    }));
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      generateProjectProposal: vi.fn().mockResolvedValue({
        proposal: {
          title: 'Titlu',
          acronym: 'ACR',
          summary: 'Rezumat',
          context: 'Context',
          objectives: { general: 'General', specific: ['S1'] },
          methodology: { approach: 'Approach', workPackages: [] },
          budget: { summary: 'Budget', categories: [] },
          indicators: [],
          sustainability: 'Sustainability',
          risks: [],
        },
        metadata: {
          tokensUsed: 1000,
          ragSourcesUsed: 2,
          factCheck: {
            confidenceScore: 0.8,
            references: [],
            unverifiableClaims: [],
          },
        },
      }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('@/app/api/ai/wizard/generate-project/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/generate-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectIdea: 'Idee suficient de lungă pentru generare automată a propunerii.',
        callId: '11111111-1111-4111-8111-111111111111',
        organization: { orgName: 'Org', orgType: 'srl', sector: 'IT' },
        locale: 'ro',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.proposal.title).toBe('Titlu');
  });

  it('save-project persists project and version snapshot', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
    }));
    vi.doMock('@/lib/ai/wizard-actions', () => ({
      saveWizardProject: vi.fn().mockResolvedValue({
        projectId: 'project-1',
        title: 'Titlu',
      }),
    }));

    const { POST } = await import('@/app/api/ai/wizard/save-project/route');
    const req = new NextRequest('http://localhost:3000/api/ai/wizard/save-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callId: '11111111-1111-4111-8111-111111111111',
        orgId: '22222222-2222-4222-8222-222222222222',
        proposal: {
          title: 'Titlu',
          summary: 'Rezumat',
          objectives: { general: 'General', specific: [] },
          methodology: { approach: 'Approach', workPackages: [] },
          budget: { summary: 'Budget', categories: [] },
          indicators: [],
          sustainability: 'Sustainability',
          risks: [],
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('project-1');
  });
});
