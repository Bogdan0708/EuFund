import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

// Mock audit
vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn(),
}));

// Mock metrics
vi.mock('@/lib/monitoring/metrics', () => ({
  trackRequest: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

// Do NOT mock the rules engine — it's pure logic, no side effects
// Do NOT mock the validation schema — it's pure Zod

describe('POST /api/ai/check-eligibility', () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/ai/check-eligibility/route');
    POST = mod.POST;
  });

  const validBody = {
    organization: {
      orgType: 'srl',
      caenPrimary: '6201',
      nutsRegion: 'RO321',
    },
    project: {
      totalBudget: 500000,
      durationMonths: 24,
    },
    call: {
      eligibleTypes: ['srl', 'sa'],
      eligibleRegions: ['RO321', 'RO322'],
      eligibleCaen: ['6201', '6202'],
      budgetMin: 100000,
      budgetMax: 1000000,
      durationMin: 12,
      durationMax: 36,
    },
  };

  function createRequest(body: any): NextRequest {
    return new NextRequest('http://localhost:3000/api/ai/check-eligibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('should return 401 without auth', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('should return 400 with invalid body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } });

    const res = await POST(createRequest({ invalid: true }));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('should return eligibility results with isEligible flag', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('results');
    expect(json.data).toHaveProperty('score');
    expect(json.data).toHaveProperty('passCount');
    expect(json.data).toHaveProperty('failCount');
    expect(json.data).toHaveProperty('warningCount');
    expect(json.data).toHaveProperty('isEligible');
    expect(json.data).toHaveProperty('checkedAt');
    expect(json.data.isEligible).toBe(true);
    expect(json.data.failCount).toBe(0);
  });

  it('should return isEligible=false when organization type is ineligible', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } });

    const body = {
      ...validBody,
      organization: { ...validBody.organization, orgType: 'pfa' },
    };

    const res = await POST(createRequest(body));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.isEligible).toBe(false);
    expect(json.data.failCount).toBeGreaterThan(0);
  });

  it('should be pure logic with no AI mocks needed', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } });

    const res = await POST(createRequest(validBody));
    const json = await res.json();

    // Should return results without needing any AI provider
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.results)).toBe(true);
    expect(json.data.results.length).toBeGreaterThan(0);

    // Each result should have bilingual messages
    for (const result of json.data.results) {
      expect(result).toHaveProperty('ruleId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('messageRo');
      expect(result).toHaveProperty('messageEn');
    }
  });
});
